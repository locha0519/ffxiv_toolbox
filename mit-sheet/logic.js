/* 排軸小抄的純計算：時間、冷卻衝突、小抄、巨集、Triggernometry、cactbot。
 * 沒有 DOM，node 與瀏覽器都能用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MitLogic = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = 1;
  const HOLD_SEC = 1.5;
  const MAX_MACRO_LINES = 15;
  const MAX_WAIT = 60;
  const MAX_MACRO_CHARS = 180;

  function createId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function uuid() {
    const bytes = new Uint8Array(16);
    const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
    if (cryptoObj && cryptoObj.getRandomValues) cryptoObj.getRandomValues(bytes);
    else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function parseTime(input) {
    if (typeof input === "number" && Number.isFinite(input)) return input;
    const raw = String(input == null ? "" : input).trim();
    if (!raw) return null;
    const neg = raw.charAt(0) === "-";
    const body = neg ? raw.slice(1) : raw;
    if (/^\d+(?:\.\d+)?$/.test(body)) {
      const n = Number(body);
      return neg ? -n : n;
    }
    const match = body.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    if (!match) return null;
    const seconds = Number(match[2]);
    if (seconds >= 60) return null;
    const total = Number(match[1]) * 60 + seconds;
    return neg ? -total : total;
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec)) return "";
    const neg = sec < -1e-9;
    let abs = Math.abs(sec);
    let minutes = Math.floor(abs / 60);
    let seconds = Math.round(abs - minutes * 60);
    if (seconds === 60) {
      minutes += 1;
      seconds = 0;
    }
    return (neg ? "-" : "") + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function formatEdit(sec) {
    if (!Number.isFinite(sec)) return "";
    const neg = sec < -1e-9;
    const abs = Math.abs(sec);
    const minutes = Math.floor((abs + 1e-9) / 60);
    const seconds = abs - minutes * 60;
    const tenth = Math.round(seconds * 10) / 10;
    const secText = Math.abs(tenth - Math.round(tenth)) < 0.01
      ? String(Math.round(tenth)).padStart(2, "0")
      : tenth.toFixed(1).padStart(4, "0");
    return (neg ? "-" : "") + String(minutes).padStart(2, "0") + ":" + secText;
  }

  function clampLead(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 2;
    return Math.min(10, Math.max(0, Math.round(n * 10) / 10));
  }

  function sortedByTime(list) {
    return (list || []).slice().sort(function (a, b) {
      if (a.time !== b.time) return a.time - b.time;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function skillOf(plan, cast) {
    return (plan.skills || []).find(function (skill) { return skill.id === cast.skillId; }) || null;
  }

  function skillName(plan, cast) {
    const skill = skillOf(plan, cast);
    if (skill) return skill.name;
    return cast.skillName || "未命名技能";
  }

  function castsForSkill(plan, skillId) {
    return sortedByTime(plan.casts).filter(function (cast) { return cast.skillId === skillId; });
  }

  function normalizeSkill(raw) {
    const name = String(raw && raw.name || "").trim();
    const cooldown = Number(raw && raw.cooldown);
    const duration = Number(raw && raw.duration);
    const charges = Math.round(Number(raw && raw.charges));
    if (!name) return null;
    if (!(cooldown > 0) || cooldown > 3600) return null;
    if (!(duration >= 0) || duration > 120) return null;
    return {
      id: String(raw.id || createId()),
      name: name.slice(0, 24),
      cooldown: cooldown,
      duration: duration,
      charges: Number.isFinite(charges) && charges >= 1 ? Math.min(9, charges) : 1
    };
  }

  function normalizePlan(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const skills = [];
    (source.skills || []).forEach(function (skill) {
      const next = normalizeSkill(skill);
      if (next) skills.push(next);
    });
    const skillIds = new Set(skills.map(function (skill) { return skill.id; }));
    const mechanics = [];
    (source.mechanics || []).forEach(function (mech) {
      const time = Number(mech && mech.time);
      const name = String(mech && mech.name || "").trim();
      if (!Number.isFinite(time) || !name) return;
      mechanics.push({ id: String(mech.id || createId()), time: time, name: name.slice(0, 40) });
    });
    const casts = [];
    (source.casts || []).forEach(function (cast) {
      const time = Number(cast && cast.time);
      if (!Number.isFinite(time)) return;
      const skillId = String(cast && cast.skillId || "");
      casts.push({
        id: String(cast.id || createId()),
        time: time,
        skillId: skillId,
        skillName: skillIds.has(skillId) ? "" : String(cast.skillName || "").slice(0, 24),
        note: String(cast && cast.note || "").trim().slice(0, 40)
      });
    });
    return {
      version: VERSION,
      demo: Boolean(source.demo),
      name: String(source.name || "").trim().slice(0, 40),
      leadSec: clampLead(source.leadSec == null ? 2 : source.leadSec),
      jobId: String(source.jobId || ""),
      raidId: String(source.raidId || "").slice(0, 40),
      libraryId: String(source.libraryId || "").slice(0, 40),
      role: /^(MT|ST|H[12]|D[1-4])$/.test(source.role) ? source.role : "",
      skills: skills,
      mechanics: sortedByTime(mechanics),
      casts: sortedByTime(casts)
    };
  }

  function demoPlan() {
    return normalizePlan({
      demo: true,
      name: "示範",
      leadSec: 2,
      jobId: "PLD",
      skills: [
        { id: "sk-reprisal", name: "雪仇", cooldown: 60, duration: 15, charges: 1 },
        { id: "sk-rampart", name: "鐵壁", cooldown: 90, duration: 20, charges: 1 },
        { id: "sk-passage", name: "武裝戍衛", cooldown: 120, duration: 18, charges: 1 }
      ],
      mechanics: [
        { id: "m1", time: 12, name: "全體傷害" },
        { id: "m2", time: 32, name: "雙重攻擊" },
        { id: "m3", time: 70, name: "分散" },
        { id: "m4", time: 102, name: "全體傷害" }
      ],
      casts: [
        { id: "c1", time: 12, skillId: "sk-reprisal", note: "全體傷害" },
        { id: "c2", time: 32, skillId: "sk-rampart", note: "雙重攻擊" },
        { id: "c3", time: 70, skillId: "sk-passage", note: "分散" },
        { id: "c4", time: 102, skillId: "sk-reprisal", note: "全體傷害" }
      ]
    });
  }

  function emptyPlan(job) {
    const plan = normalizePlan({ name: "", leadSec: 2, jobId: job ? job.id : "", skills: [], mechanics: [], casts: [] });
    if (job) applyJob(plan, job);
    plan.demo = false;
    return plan;
  }

  function applyJob(plan, job) {
    const previous = {};
    (plan.skills || []).forEach(function (skill) { previous[skill.id] = skill; });
    plan.jobId = job.id;
    plan.skills = job.skills.map(function (skill) {
      return {
        id: createId(),
        name: skill.name,
        cooldown: skill.cooldown,
        duration: skill.duration,
        charges: skill.charges || 1
      };
    });
    const byName = {};
    plan.skills.forEach(function (skill) { byName[skill.name] = skill.id; });
    (plan.casts || []).forEach(function (cast) {
      const old = previous[cast.skillId];
      if (old && byName[old.name]) {
        cast.skillId = byName[old.name];
        cast.skillName = "";
      } else if (old) {
        cast.skillName = old.name;
      }
    });
    plan.demo = false;
    return plan;
  }

  function addSkill(plan, raw) {
    const skill = normalizeSkill(raw);
    if (!skill) return null;
    plan.skills.push(skill);
    plan.demo = false;
    return skill;
  }

  function addCast(plan, raw) {
    const time = Number(raw.time);
    const skillId = String(raw.skillId || "");
    if (!Number.isFinite(time) || !skillId) return null;
    const duplicate = (plan.casts || []).some(function (cast) {
      return cast.skillId === skillId && Math.abs(cast.time - time) < 0.05;
    });
    if (duplicate) return null;
    const cast = {
      id: createId(),
      time: time,
      skillId: skillId,
      skillName: "",
      note: String(raw.note || "").trim().slice(0, 40)
    };
    plan.casts.push(cast);
    plan.casts = sortedByTime(plan.casts);
    plan.demo = false;
    return cast;
  }

  function parseMechanics(text) {
    const out = [];
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      const line = raw.trim();
      if (!line || line.charAt(0) === "#") return;
      const match = line.match(/^(\S+)\s+(.+)$/);
      if (!match) return;
      const time = parseTime(match[1]);
      if (time == null) return;
      out.push({ time: time, name: match[2].trim().slice(0, 40) });
    });
    return out;
  }

  function conflicts(plan) {
    const out = {};
    const groups = new Map();
    sortedByTime(plan.casts).forEach(function (cast) {
      if (!groups.has(cast.skillId)) groups.set(cast.skillId, []);
      groups.get(cast.skillId).push(cast);
    });
    groups.forEach(function (uses, skillId) {
      const skill = (plan.skills || []).find(function (item) { return item.id === skillId; });
      if (!skill || !(skill.cooldown > 0)) return;
      const charges = Math.max(1, skill.charges || 1);
      const ready = [];
      let available = charges;
      uses.forEach(function (cast) {
        while (ready.length && ready[0] <= cast.time + 1e-6) {
          ready.shift();
          available += 1;
        }
        if (available <= 0) {
          out[cast.id] = { short: Math.max(0, ready[0] - cast.time) };
          ready.push(cast.time + skill.cooldown);
          ready.sort(function (a, b) { return a - b; });
        } else {
          available -= 1;
          ready.push(cast.time + skill.cooldown);
          ready.sort(function (a, b) { return a - b; });
        }
      });
    });
    return out;
  }

  function focusCast(casts, elapsed, lead, hold) {
    const windowHold = hold == null ? HOLD_SEC : hold;
    const ahead = lead == null ? 0 : lead;
    let inWindow = null;
    for (let i = 0; i < casts.length; i += 1) {
      const cast = casts[i];
      const start = cast.time - ahead;
      const end = cast.time + windowHold;
      if (elapsed >= start && elapsed <= end) inWindow = cast;
      else if (elapsed < start) return inWindow || cast;
    }
    return inWindow;
  }

  function phaseOf(cast, elapsed, lead, hold) {
    if (!cast) return "done";
    const windowHold = hold == null ? HOLD_SEC : hold;
    if (elapsed < cast.time - lead) return "wait";
    if (elapsed < cast.time) return "ready";
    if (elapsed <= cast.time + windowHold) return "now";
    return "wait";
  }

  function fightSpan(plan) {
    let end = 60;
    (plan.mechanics || []).forEach(function (item) { end = Math.max(end, item.time); });
    (plan.casts || []).forEach(function (item) {
      const skill = skillOf(plan, item);
      end = Math.max(end, item.time + (skill ? skill.duration : 0));
    });
    return Math.ceil(end + 20);
  }

  function nearestMechanic(plan, time) {
    let best = null;
    let bestDistance = 4;
    (plan.mechanics || []).forEach(function (mech) {
      const distance = Math.abs(mech.time - time);
      if (distance < bestDistance) {
        best = mech;
        bestDistance = distance;
      }
    });
    return best;
  }

  function cheatSheetText(plan) {
    const name = plan.name || "未命名";
    const lead = plan.leadSec;
    const lines = [
      name,
      "時間是按下技能的時間。提醒會再早 " + lead + " 秒。",
      ""
    ];
    const issues = conflicts(plan);
    lines.push("依時間");
    if (!plan.casts.length) lines.push("（還沒排技能）");
    sortedByTime(plan.casts).forEach(function (cast) {
      const note = cast.note ? "  " + cast.note : "";
      const warn = issues[cast.id] ? "  冷卻還差 " + Math.ceil(issues[cast.id].short) + " 秒" : "";
      lines.push(formatTime(cast.time) + "  " + skillName(plan, cast) + note + warn);
    });
    lines.push("", "依技能");
    if (!plan.skills.length) lines.push("（還沒有技能）");
    plan.skills.forEach(function (skill) {
      const uses = castsForSkill(plan, skill.id);
      lines.push(skill.name);
      if (!uses.length) lines.push("  （這場還沒排）");
      uses.forEach(function (cast) {
        const note = cast.note ? "  " + cast.note : "";
        const warn = issues[cast.id] ? "  冷卻還差 " + Math.ceil(issues[cast.id].short) + " 秒" : "";
        lines.push("  " + formatTime(cast.time) + note + warn);
      });
    });
    return lines.join("\n") + "\n";
  }

  function cleanMacro(text) {
    return String(text).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  }

  function reminderEvents(plan) {
    const lead = Number(plan.leadSec) || 0;
    const buckets = new Map();
    sortedByTime(plan.casts).forEach(function (cast) {
      const at = Math.round(cast.time - lead);
      if (!buckets.has(at)) buckets.set(at, []);
      buckets.get(at).push(cast);
    });
    return Array.from(buckets.entries()).sort(function (a, b) { return a[0] - b[0]; }).map(function (entry) {
      const at = entry[0];
      const casts = entry[1];
      const names = casts.map(function (cast) { return cleanMacro(skillName(plan, cast)); });
      let body = "/e " + casts.map(function (cast) {
        const note = cast.note ? " " + cleanMacro(cast.note) : "";
        return formatTime(cast.time) + " " + cleanMacro(skillName(plan, cast)) + note;
      }).join("、") + " <se.6>";
      if (body.length > 170) body = "/e " + names.join("、") + " <se.6>";
      return { at: at, text: body, speech: "開" + names.join("、") };
    });
  }

  function macroLines(events) {
    const lines = [];
    let clock = 0;
    events.forEach(function (event) {
      let gap = Math.round(event.at - clock);
      if (gap < 0) gap = 0;
      if (gap > 0 && lines.length) {
        const room = MAX_WAIT - lines[lines.length - 1].wait;
        const onto = Math.min(room, gap);
        lines[lines.length - 1].wait += onto;
        gap -= onto;
        clock += onto;
      }
      while (gap > 0) {
        const wait = Math.min(MAX_WAIT, gap);
        lines.push({ text: "/e ⋯", wait: wait });
        gap -= wait;
        clock += wait;
      }
      lines.push({ text: event.text, wait: 0 });
      clock = Math.round(event.at);
    });
    return lines;
  }

  function renderMacroLine(line) {
    const wait = line.wait > 0 ? "<wait." + line.wait + ">" : "";
    const text = line.text + wait;
    return text.length > MAX_MACRO_CHARS ? text.slice(0, MAX_MACRO_CHARS) : text;
  }

  function linesFor(events, anchor) {
    return macroLines(events.map(function (event) {
      return { at: event.at - anchor, text: event.text };
    }));
  }

  // 第一條從開打（或開打前）起算，所以前面的等待要算進行數。
  // 後面每一條改從該條第一個提醒起算，玩家在那個時間按下。
  function chunkEvents(events) {
    const chunks = [];
    let current = [];
    let first = true;
    function anchorOf(list, isFirst) {
      return isFirst || !list.length ? 0 : list[0].at;
    }
    events.forEach(function (event) {
      const trial = current.concat([event]);
      if (current.length && linesFor(trial, anchorOf(trial, first)).length > MAX_MACRO_LINES) {
        chunks.push({ events: current, anchor: anchorOf(current, first) });
        current = [event];
        first = false;
      } else current.push(event);
    });
    if (current.length) chunks.push({ events: current, anchor: anchorOf(current, first) });
    return chunks;
  }

  function macroText(plan) {
    const events = reminderEvents(plan);
    const name = plan.name || "未命名";
    if (!events.length) return name + "\n還沒排技能。\n";
    const shift = Math.min(0, events[0].at);
    const shifted = events.map(function (event) {
      return { at: event.at - shift, text: event.text, speech: event.speech };
    });
    const chunks = chunkEvents(shifted);
    const header = [
      name,
      "巨集會提前 " + plan.leadSec + " 秒跳出提示。每條最多 15 行，這是遊戲上限。"
    ];
    const blocks = chunks.map(function (chunk, index) {
      const lines = linesFor(chunk.events, chunk.anchor).map(renderMacroLine);
      const pressAt = chunk.anchor + shift;
      let when = "請在戰鬥經過 " + formatTime(pressAt) + " 時按下";
      if (index === 0 && chunk.anchor === 0 && shift < 0) when = "請在開打前 " + Math.abs(shift) + " 秒按下";
      else if (index === 0 && chunk.anchor === 0) when = "請在開打瞬間按下";
      return "# " + (index + 1) + "（" + when + "）\n" + lines.join("\n");
    });
    return header.join("\n") + "\n\n" + blocks.join("\n\n") + "\n";
  }

  function xmlEscape(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function triggerXml(plan) {
    const events = reminderEvents(plan);
    const actions = events.map(function (event, index) {
      const offset = Math.round(event.at * 10) / 10;
      const signed = offset < 0 ? String(offset) : "+" + offset;
      const delay = "(${cd}" + signed + ")*1000";
      return '          <Action OrderNumber="' + (index + 1) + '" ActionType="UseTTS" ExecutionDelayExpression="' + xmlEscape(delay) + '" UseTTSTextExpression="' + xmlEscape(event.speech) + '" />';
    }).join("\n");
    const regex = "00:0038::.*?(?<cd>\\d+)\\s*(?:seconds|秒)";
    const title = (plan.name || "未命名") + " 小抄";
    return [
      '<?xml version="1.0"?>',
      '<TriggernometryExport>',
      '  <ExportedFolder Id="' + uuid() + '" Name="' + xmlEscape(title) + '" Enabled="true">',
      "    <Triggers>",
      '      <Trigger Enabled="true" Name="開打倒數" Id="' + uuid() + '" PrevActions="Interrupt" RegularExpression="' + xmlEscape(regex) + '">',
      "        <Actions>",
      actions,
      "        </Actions>",
      "      </Trigger>",
      "    </Triggers>",
      "  </ExportedFolder>",
      "</TriggernometryExport>",
      ""
    ].join("\n");
  }

  function cactbotText(plan) {
    const events = reminderEvents(plan);
    const lines = [
      "# " + (plan.name || "未命名"),
      "# 排軸小抄匯出。同步點是開打前 10 秒的倒數。",
      '-10.0 "--sync--" sync /00:0038::.*10\\s*(?:seconds|秒)/ window 20,20'
    ];
    events.forEach(function (event) {
      const at = Math.round(event.at * 10) / 10;
      lines.push(at.toFixed(1) + ' "' + event.speech.replace(/"/g, "") + '"');
    });
    return lines.join("\n") + "\n";
  }

  function exportJson(plan) {
    return JSON.stringify(normalizePlan(plan), null, 2) + "\n";
  }

  const ROLE_SLOTS = ["MT", "ST", "H1", "H2", "D1", "D2", "D3", "D4"];

  function isMitBackup(raw) {
    return !!(raw && typeof raw === "object" && raw.assignments && typeof raw.assignments === "object" && !Array.isArray(raw.casts));
  }

  function splitInstanceId(key) {
    const at = String(key).lastIndexOf("#");
    if (at <= 0) return null;
    const slot = Number(key.slice(at + 1));
    if (!Number.isInteger(slot) || slot < 0 || slot > 7) return null;
    return { skillId: key.slice(0, at), slot: slot };
  }

  function jobCode(skillId) {
    const text = String(skillId || "");
    const cut = text.indexOf("_");
    if (cut <= 0) return "";
    return text.slice(0, cut);
  }

  function mitBackupChoices(backup) {
    const assignments = (backup && backup.assignments) || {};
    const raids = [];
    Object.keys(assignments).forEach(function (raidId) {
      const phases = assignments[raidId] || {};
      const byRole = {};
      const byJob = {};
      ROLE_SLOTS.forEach(function (role, slot) {
        byRole[role] = { role: role, slot: slot, casts: 0, job: "" };
      });
      Object.keys(phases).forEach(function (phaseId) {
        const map = phases[phaseId] || {};
        Object.keys(map).forEach(function (key) {
          const parsed = splitInstanceId(key);
          if (!parsed || !byRole[ROLE_SLOTS[parsed.slot]]) return;
          const list = map[key];
          if (!Array.isArray(list)) return;
          byRole[ROLE_SLOTS[parsed.slot]].casts += list.length;
          const code = jobCode(parsed.skillId);
          if (!code) return;
          const id = ROLE_SLOTS[parsed.slot] + "|" + code;
          if (!byJob[id]) byJob[id] = { role: ROLE_SLOTS[parsed.slot], job: code, casts: 0 };
          byJob[id].casts += list.length;
        });
      });
      const party = (backup.parties && backup.parties[raidId]) || backup.party || [];
      party.forEach(function (member) {
        if (member && byRole[member.role]) byRole[member.role].job = String(member.job || "");
      });
      const roles = ROLE_SLOTS.map(function (role) { return byRole[role]; }).filter(function (item) { return item.casts > 0; });
      const jobs = Object.keys(byJob).map(function (id) { return byJob[id]; }).filter(function (item) {
        return item.casts > 0;
      });
      jobs.sort(function (a, b) {
        if (a.role !== b.role) return ROLE_SLOTS.indexOf(a.role) - ROLE_SLOTS.indexOf(b.role);
        return b.casts - a.casts;
      });
      if (!roles.length && !jobs.length) return;
      raids.push({
        id: raidId,
        casts: roles.reduce(function (sum, item) { return sum + item.casts; }, 0),
        roles: roles,
        jobs: jobs
      });
    });
    const settings = (backup && backup.settings) || {};
    const defaultRaid = settings.raid && raids.some(function (raid) { return raid.id === settings.raid; })
      ? settings.raid
      : ((raids[0] && raids[0].id) || "");
    const raid = raids.find(function (item) { return item.id === defaultRaid; });
    let defaultRole = settings.myRole || "";
    if (!raid || !raid.roles.some(function (item) { return item.role === defaultRole; })) {
      defaultRole = raid && raid.roles[0] ? raid.roles[0].role : "";
    }
    const partyJob = raid && (raid.roles.find(function (item) { return item.role === defaultRole; }) || {}).job;
    const jobs = (raid && raid.jobs) || [];
    const picked = jobs.find(function (item) { return item.role === defaultRole && item.job === partyJob; })
      || jobs.find(function (item) { return item.role === defaultRole; })
      || jobs[0]
      || null;
    if (picked) defaultRole = picked.role;
    return {
      raids: raids,
      defaultRaid: defaultRaid,
      defaultRole: defaultRole,
      defaultJob: picked ? picked.job : "",
      defaultJobKey: picked ? picked.role + "|" + picked.job : "",
      leadSec: clampLead(settings.macroLeadSec == null ? 2 : settings.macroLeadSec)
    };
  }

  function castOffsetOf(map, instanceId, idx) {
    if (!map) return 0;
    const value = map[instanceId + "@" + idx];
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 120 || Math.floor(value) !== value) return 0;
    return value;
  }

  function phaseStarts(raid, phaseBodies, gaps) {
    const order = (raid.phases || []).map(function (phase) { return phase.id; });
    const lengths = {};
    order.forEach(function (id) {
      const actions = (phaseBodies[id] && phaseBodies[id].actions) || [];
      let max = 0;
      actions.forEach(function (action) {
        if (typeof action.timeSec === "number" && action.timeSec > max) max = action.timeSec;
      });
      lengths[id] = max;
    });
    const starts = {};
    let cursor = 0;
    for (let i = 0; i < order.length; i += 1) {
      starts[order[i]] = cursor;
      const next = order[i + 1];
      if (!next) break;
      const gap = gaps && gaps[next] != null ? Number(gaps[next]) || 0 : 0;
      const delta = (lengths[order[i]] || 0) + gap;
      cursor = Math.max(cursor, cursor + delta);
    }
    return starts;
  }

  // bundle: { raid, skills, phases:{ phaseId: timeline }, gaps, jobLabel }
  // 時間跟減傷表同一套：階段起點 + 機制 timeSec + 那一格的 castOffset。
  function mitPlanFromBackup(backup, raidId, role, bundle) {
    if (!isMitBackup(backup)) throw new Error("這不是減傷表備份");
    const choices = mitBackupChoices(backup);
    const raidChoice = choices.raids.find(function (item) { return item.id === raidId; });
    if (!raidChoice) throw new Error("這份備份裡沒有這一場");
    const roleChoice = raidChoice.roles.find(function (item) { return item.role === role; });
    if (!roleChoice) throw new Error("這個位置沒有排技能");
    const onlyJob = (bundle && bundle.onlyJob) || roleChoice.job;
    const raid = bundle.raid || { id: raidId, phases: [] };
    const skillRows = bundle.skills || [];
    const bySkillId = {};
    skillRows.forEach(function (skill) { if (skill && skill.id) bySkillId[skill.id] = skill; });
    const phaseBodies = bundle.phases || {};
    const savedGaps = backup.settings && backup.settings.phaseGaps && backup.settings.phaseGaps[raidId];
    const gaps = Object.assign({}, raid.defaultPhaseGaps || {}, savedGaps || {});
    const starts = phaseStarts(raid, phaseBodies, gaps);
    const order = (raid.phases || []).map(function (phase) { return phase.id; });
    const labels = {};
    (raid.phases || []).forEach(function (phase) { labels[phase.id] = phase.label || phase.id; });
    const used = [];
    let skippedOtherJob = 0;
    order.forEach(function (phaseId) {
      const assigned = (((backup.assignments || {})[raidId] || {})[phaseId]) || {};
      const offsets = (((backup.castOffsets || {})[raidId] || {})[phaseId]) || {};
      const actions = (phaseBodies[phaseId] && phaseBodies[phaseId].actions) || [];
      const byIdx = {};
      actions.forEach(function (action) {
        if (action && typeof action.idx === "number") byIdx[action.idx] = action;
      });
      Object.keys(assigned).forEach(function (key) {
        const parsed = splitInstanceId(key);
        if (!parsed || parsed.slot !== roleChoice.slot) return;
        const sourceJob = (bySkillId[parsed.skillId] && bySkillId[parsed.skillId].job) || jobCode(parsed.skillId);
        if (onlyJob && sourceJob && sourceJob !== onlyJob) {
          if (Array.isArray(assigned[key])) skippedOtherJob += assigned[key].length;
          return;
        }
        const list = assigned[key];
        if (!Array.isArray(list)) return;
        list.forEach(function (idx) {
          const action = byIdx[idx];
          if (!action || typeof action.timeSec !== "number") return;
          const offset = castOffsetOf(offsets, key, idx);
          used.push({
            phaseId: phaseId,
            skillId: parsed.skillId,
            time: starts[phaseId] + action.timeSec + offset,
            mechanicTime: starts[phaseId] + action.timeSec,
            note: String(action.actionTC || action.actionJP || "").trim()
          });
        });
      });
    });
    if (!used.length) throw new Error("時間軸上對不到這些技能");
    const phaseIds = [];
    used.forEach(function (item) {
      if (phaseIds.indexOf(item.phaseId) < 0) phaseIds.push(item.phaseId);
    });
    const skills = [];
    const seenSkills = {};
    used.forEach(function (item) {
      if (seenSkills[item.skillId]) return;
      seenSkills[item.skillId] = true;
      const source = bySkillId[item.skillId] || {};
      const skill = normalizeSkill({
        id: item.skillId,
        name: source.nameTC || source.name || item.skillId,
        cooldown: source.recastSec || source.cooldown || 1,
        duration: source.durationSec != null ? source.durationSec : (source.duration || 0),
        charges: source.charges || 1
      });
      if (skill) skills.push(skill);
    });
    const mechanics = [];
    const seenMech = {};
    const casts = [];
    used.forEach(function (item) {
      const note = (phaseIds.length > 1 && labels[item.phaseId] ? labels[item.phaseId] + " " : "") + item.note;
      const mechKey = item.phaseId + "@" + item.mechanicTime + "@" + note;
      if (!seenMech[mechKey] && item.note) {
        seenMech[mechKey] = true;
        mechanics.push({ id: createId(), time: item.mechanicTime, name: note });
      }
      casts.push({
        id: createId(),
        time: item.time,
        skillId: item.skillId,
        note: note
      });
    });
    const shortName = (raid.shortName || raid.name || raidId);
    const jobLabel = bundle.jobLabel || roleChoice.job || "";
    const plan = normalizePlan({
      name: (shortName + " " + role + (jobLabel ? " " + jobLabel : "")).trim(),
      leadSec: choices.leadSec,
      jobId: onlyJob || roleChoice.job || "",
      raidId: raidId,
      role: role,
      skills: skills,
      mechanics: mechanics,
      casts: casts
    });
    plan.skippedOtherJob = skippedOtherJob;
    return plan;
  }

  function importJson(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new Error("這個檔案不是排軸檔");
    }
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.casts) || !Array.isArray(raw.skills)) {
      throw new Error("這個檔案不是排軸檔");
    }
    return normalizePlan(raw);
  }

  function takeSeconds(match) {
    if (!match) return null;
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) return null;
    return seconds;
  }

  function parseCountdown(text) {
    const line = String(text || "");
    let found = takeSeconds(line.match(/Battle commencing in (\d+) seconds/i))
      || takeSeconds(line.match(/距開戰\s*(\d+)\s*秒/))
      || takeSeconds(line.match(/戰鬥開始倒數[:：]?\s*(\d+)/))
      || takeSeconds(line.match(/開戰倒數[:：]?\s*(\d+)/))
      || takeSeconds(line.match(/戦闘開始まで\s*(\d+)\s*秒/));
    if (found != null) return found;
    if (!/0038/.test(line)) return null;
    return takeSeconds(line.match(/(\d+)\s*(?:seconds|秒)/i));
  }

  function parseEngage(text) {
    const line = String(text || "");
    if (parseCountdown(line) != null) return false;
    if (/Battle commencing!/i.test(line)) return true;
    if (/engages!/i.test(line)) return true;
    if (/發動攻擊|開始戰鬥|戰鬥開始(?!倒數)/.test(line)) return true;
    return false;
  }

  const JOB_BY_ID = {
    "1": "GLA", "2": "PGL", "3": "MRD", "4": "LNC", "5": "ARC", "6": "CNJ", "7": "THM",
    "8": "CRP", "9": "BSM", "10": "ARM", "11": "GSM", "12": "LTW", "13": "WVR", "14": "ALC", "15": "CUL",
    "16": "MIN", "17": "BTN", "18": "FSH",
    "19": "PLD", "20": "MNK", "21": "WAR", "22": "DRG", "23": "BRD", "24": "WHM", "25": "BLM",
    "26": "ACN", "27": "SMN", "28": "SCH", "29": "NIN", "30": "MCH", "31": "DRK", "32": "AST",
    "33": "SAM", "34": "RDM", "35": "BLU", "36": "GNB", "37": "DNC", "38": "RPR", "39": "SGE",
    "40": "VPR", "41": "PCT", "42": "PLD"
  };

  const JOB_BY_NAME = {
    "騎士": "PLD", "paladin": "PLD", "pld": "PLD",
    "戰士": "WAR", "warrior": "WAR", "war": "WAR",
    "暗黑騎士": "DRK", "dark knight": "DRK", "drk": "DRK",
    "絕槍戰士": "GNB", "gunbreaker": "GNB", "gnb": "GNB",
    "白魔法師": "WHM", "white mage": "WHM", "whm": "WHM",
    "學者": "SCH", "scholar": "SCH", "sch": "SCH",
    "占星術士": "AST", "astrologian": "AST", "ast": "AST",
    "賢者": "SGE", "sage": "SGE", "sge": "SGE",
    "武僧": "MNK", "monk": "MNK", "mnk": "MNK",
    "龍騎士": "DRG", "dragoon": "DRG", "drg": "DRG",
    "忍者": "NIN", "ninja": "NIN", "nin": "NIN",
    "武士": "SAM", "samurai": "SAM", "sam": "SAM",
    "鐮刀戰士": "RPR", "reaper": "RPR", "rpr": "RPR",
    "蝰蛇劍士": "VPR", "viper": "VPR", "vpr": "VPR",
    "詩人": "BRD", "bard": "BRD", "brd": "BRD",
    "機工士": "MCH", "machinist": "MCH", "mch": "MCH",
    "舞者": "DNC", "dancer": "DNC", "dnc": "DNC",
    "黑魔法師": "BLM", "black mage": "BLM", "blm": "BLM",
    "召喚師": "SMN", "summoner": "SMN", "smn": "SMN",
    "赤魔法師": "RDM", "red mage": "RDM", "rdm": "RDM",
    "繪影法師": "PCT", "pictomancer": "PCT", "pct": "PCT"
  };

  function knownJob(code) {
    const raw = String(code || "").trim();
    if (!raw) return "";
    if (JOB_BY_ID[raw]) {
      const mapped = JOB_BY_ID[raw];
      return mapped === "GLA" || mapped === "MRD" ? (mapped === "GLA" ? "PLD" : "WAR") : mapped;
    }
    const named = JOB_BY_NAME[raw] || JOB_BY_NAME[raw.toLowerCase()];
    if (named) return named;
    const upper = raw.toUpperCase();
    return /^[A-Z]{3}$/.test(upper) ? upper : "";
  }

  function parseJobChange(text) {
    const line = String(text || "");
    const parts = line.split("|");
    const type = parts[0] === "00" || /^\d{2}:/.test(parts[0]) ? (parts[2] || parts[0]) : parts[0];
    if (/^(02|ChangePrimaryPlayer)$/i.test(type) || /ChangePrimaryPlayer/i.test(line)) {
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const job = knownJob(parts[i]);
        if (job) return job;
      }
    }
    if (/^(03|AddCombatant)$/i.test(type)) {
      const job = knownJob(parts[5] || parts[6] || "");
      if (job) return job;
    }
    if (/^(0C|PlayerStats)$/i.test(type)) {
      const job = knownJob(parts[1] || parts[2] || "");
      if (job) return job;
    }
    const spoken = line.match(/You change to (?:the )?(?:class|job) ([^.|\r\n]+)/i)
      || line.match(/You change to ([^.|\r\n]+)/i)
      || line.match(/You are now a ([^.|\r\n]+)/i)
      || line.match(/職業(?:變更|改)為([^。|\r\n]+)/)
      || line.match(/你現在是([^。|\r\n]+)/)
      || line.match(/變更為([^。|\r\n]+)/);
    if (spoken) {
      const job = knownJob(spoken[1].trim());
      if (job) return job;
    }
    return "";
  }

  const ZONE_IDS = {
    1257: "m5s", 1259: "m6s", 1261: "m7s", 1263: "m8s",
    1321: "m9s", 1323: "m10s", 1325: "m11s", 1327: "m12s",
    1238: "fru"
  };

  const RAID_HINTS = [
    { id: "m12s", names: ["m12s", "林德布魯姆", "aac heavyweight m4"] },
    { id: "m11s", names: ["m11s", "霸王", "aac heavyweight m3"] },
    { id: "m10s", names: ["m10s", "深藍", "熾紅", "aac heavyweight m2"] },
    { id: "m9s", names: ["m9s", "致命美人", "aac heavyweight m1"] },
    { id: "m8s", names: ["m8s", "呼嘯之劍", "aac cruiserweight m4", "輕量級第4層"] },
    { id: "m7s", names: ["m7s", "野蠻憎惡", "aac cruiserweight m3", "輕量級第3層"] },
    { id: "m6s", names: ["m6s", "糖彩狂潮", "蜜糖暴動", "sugar riot", "aac cruiserweight m2", "輕量級第2層"] },
    { id: "m5s", names: ["m5s", "熱舞綠光", "aac cruiserweight m1", "輕量級第1層"] },
    { id: "fru", names: ["fru", "futures rewritten", "絕伊甸", "光暗未來"] }
  ];

  function raidFromZoneId(value) {
    const text = String(value == null ? "" : value).replace(/^0x/i, "").trim();
    if (!text) return "";
    const dec = Number(text);
    if (Number.isFinite(dec) && ZONE_IDS[dec]) return ZONE_IDS[dec];
    const hex = parseInt(text, 16);
    return Number.isFinite(hex) && ZONE_IDS[hex] ? ZONE_IDS[hex] : "";
  }

  function raidFromZoneName(name) {
    const blob = String(name || "").toLowerCase();
    if (!blob) return "";
    for (let i = 0; i < RAID_HINTS.length; i += 1) {
      const raid = RAID_HINTS[i];
      for (let j = 0; j < raid.names.length; j += 1) {
        if (blob.indexOf(raid.names[j]) >= 0) return raid.id;
      }
    }
    return "";
  }

  function parseZoneChange(text) {
    const line = String(text || "");
    const match = line.match(/(?:^|\|)(?:01|ChangeZone)\|([0-9A-Fa-f]+)\|([^|\r\n]*)/);
    if (match) return raidFromZoneId(match[1]) || raidFromZoneName(match[2]) || "";
    return raidFromZoneName(line);
  }

  function parseWipe(text) {
    const line = String(text || "");
    if (/has been defeated by/i.test(line) && /you/i.test(line)) return true;
    if (/wipe/i.test(line) && /00:?4000000[fF]|4000000[fF]/.test(line)) return true;
    if (/全員全滅|任務失敗/.test(line)) return true;
    return false;
  }

  function safeFile(name) {
    const cleaned = String(name || "排軸小抄").replace(/[\\/:*?"<>|]/g, " ").trim() || "排軸小抄";
    return cleaned.slice(0, 40);
  }

  return {
    VERSION: VERSION,
    HOLD_SEC: HOLD_SEC,
    createId: createId,
    parseTime: parseTime,
    formatTime: formatTime,
    formatEdit: formatEdit,
    clampLead: clampLead,
    normalizePlan: normalizePlan,
    demoPlan: demoPlan,
    emptyPlan: emptyPlan,
    applyJob: applyJob,
    addSkill: addSkill,
    addCast: addCast,
    parseMechanics: parseMechanics,
    skillOf: skillOf,
    skillName: skillName,
    castsForSkill: castsForSkill,
    conflicts: conflicts,
    focusCast: focusCast,
    phaseOf: phaseOf,
    fightSpan: fightSpan,
    nearestMechanic: nearestMechanic,
    cheatSheetText: cheatSheetText,
    reminderEvents: reminderEvents,
    macroLines: macroLines,
    macroText: macroText,
    triggerXml: triggerXml,
    cactbotText: cactbotText,
    exportJson: exportJson,
    importJson: importJson,
    isMitBackup: isMitBackup,
    mitBackupChoices: mitBackupChoices,
    mitPlanFromBackup: mitPlanFromBackup,
    parseCountdown: parseCountdown,
    parseEngage: parseEngage,
    parseJobChange: parseJobChange,
    parseZoneChange: parseZoneChange,
    raidFromZoneId: raidFromZoneId,
    raidFromZoneName: raidFromZoneName,
    parseWipe: parseWipe,
    knownJob: knownJob,
    safeFile: safeFile,
    sortedByTime: sortedByTime
  };
});
