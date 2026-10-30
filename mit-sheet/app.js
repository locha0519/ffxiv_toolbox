/* 排軸小抄的畫面。資料存在這個網址的 localStorage。 */
(function () {
  "use strict";

  const L = window.MitLogic;
  const Skills = window.MitSkills;
  const STORAGE = "mit-sheet:v1";
  const UIKEY = "mit-sheet:ui";
  const PX = 12;
  const COLORS = ["#e2b86a", "#d7eccf", "#e08b7a", "#9ec3e6", "#d7b8e6", "#f0d2a0", "#c9d6a3"];

  const ui = loadUi();
  const state = {
    plan: loadPlan(),
    armed: null,
    mode: ui.mode === "sheet" ? "sheet" : "plan",
    group: ui.group === "skill" ? "skill" : "time",
    overlay: false,
    overlayHooked: false,
    suppressClick: false,
    clock: { zeroAt: null, paused: null, source: "idle" },
    lastFocusId: null,
    pendingDelete: null,
    ticking: false,
    mitBackup: null,
    mitChoices: null,
    mitNames: {}
  };

  const fightName = document.getElementById("fight-name");
  const leadInput = document.getElementById("lead");
  const jobSelect = document.getElementById("job");

  bind();
  fillJobs();
  fillStatic();
  setMode(state.mode);
  renderAll();
  showOrigin();
  watchOverlay();

  function loadPlan() {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (!raw) return L.demoPlan();
      return L.importJson(raw);
    } catch (error) {
      return L.demoPlan();
    }
  }

  function loadUi() {
    try { return JSON.parse(localStorage.getItem(UIKEY) || "{}"); }
    catch (error) { return {}; }
  }

  function saveUi() {
    localStorage.setItem(UIKEY, JSON.stringify({
      mode: state.mode,
      group: state.group
    }));
  }

  function persist() {
    state.plan = L.normalizePlan(state.plan);
    localStorage.setItem(STORAGE, JSON.stringify(state.plan));
  }

  function bind() {
    document.body.addEventListener("click", onClick);
    document.body.addEventListener("change", onChange);
    document.body.addEventListener("submit", onSubmit);
    document.getElementById("timeline").addEventListener("pointerdown", onPointerDown);
    document.getElementById("timeline").addEventListener("click", onTimelineClick);
    fightName.addEventListener("input", function () {
      state.plan.name = fightName.value;
      state.plan.demo = false;
      persist();
      updateDemoNote();
      document.title = state.plan.name ? state.plan.name + " · 排軸小抄" : "排軸小抄";
    });
    leadInput.addEventListener("change", function () {
      state.plan.leadSec = L.clampLead(leadInput.value);
      leadInput.value = String(state.plan.leadSec);
      state.plan.demo = false;
      persist();
    });
    document.getElementById("import-file").addEventListener("change", onImport);
    document.addEventListener("keydown", onKey);
    window.addEventListener("storage", function (event) {
      if (event.key !== STORAGE || !event.newValue) return;
      try { state.plan = L.importJson(event.newValue); }
      catch (error) { return; }
      fillStatic();
      renderAll();
    });
  }

  function fillJobs() {
    let groupName = "";
    let group = null;
    Skills.jobs.forEach(function (job) {
      if (job.group !== groupName) {
        group = document.createElement("optgroup");
        group.label = job.group;
        jobSelect.appendChild(group);
        groupName = job.group;
      }
      const option = document.createElement("option");
      option.value = job.id;
      option.textContent = job.name;
      group.appendChild(option);
    });
  }

  function fillStatic() {
    fightName.value = state.plan.name || "";
    leadInput.value = String(state.plan.leadSec);
    if (state.plan.jobId && Skills.byId(state.plan.jobId)) jobSelect.value = state.plan.jobId;
    document.title = state.plan.name ? state.plan.name + " · 排軸小抄" : "排軸小抄";
    updateDemoNote();
  }

  function showOrigin() {
    const node = document.getElementById("origin-url");
    if (location.protocol === "file:") node.textContent = "http://127.0.0.1:8766/";
    else node.textContent = location.href.split("#")[0];
  }

  function setMode(mode) {
    state.mode = mode === "sheet" ? "sheet" : "plan";
    document.body.classList.toggle("mode-sheet", state.mode === "sheet");
    document.body.classList.toggle("mode-plan", state.mode === "plan");
    document.getElementById("plan").hidden = state.mode !== "plan";
    document.getElementById("sheet").hidden = state.mode !== "sheet";
    document.getElementById("mode-plan").setAttribute("aria-pressed", String(state.mode === "plan"));
    document.getElementById("mode-sheet").setAttribute("aria-pressed", String(state.mode === "sheet"));
    saveUi();
    if (state.mode === "sheet") {
      renderSheetList();
      paintSheet();
      ensureTick();
    }
  }

  function renderAll() {
    updateDemoNote();
    updateArmHint();
    updateGroupButtons();
    renderSkills();
    renderBoard();
    renderSheetList();
    paintSheet();
  }

  function updateDemoNote() {
    document.getElementById("demo-note").hidden = !state.plan.demo;
  }

  function updateArmHint() {
    const skill = state.plan.skills.find(function (item) { return item.id === state.armed; });
    document.getElementById("arm-hint").textContent = skill
      ? "正在排「" + skill.name + "」。點時間軸、機制，或下面的時間。"
      : "先點左邊的技能，再點時間軸或機制。";
  }

  function updateGroupButtons() {
    document.getElementById("group-time").setAttribute("aria-pressed", String(state.group === "time"));
    document.getElementById("group-skill").setAttribute("aria-pressed", String(state.group === "skill"));
  }

  function renderSkills() {
    const list = document.getElementById("skill-list");
    clear(list);
    const issues = L.conflicts(state.plan);
    if (!state.plan.skills.length) {
      list.appendChild(el("p", "hint", "載入職業，或自己加一招。"));
      return;
    }
    state.plan.skills.forEach(function (skill) {
      const uses = L.castsForSkill(state.plan, skill.id);
      const bad = uses.some(function (cast) { return issues[cast.id]; });
      const card = el("div", "skill" + (state.armed === skill.id ? " on" : "") + (bad ? " bad" : ""));
      const main = button("skill-main", null, "arm", { id: skill.id });
      const when = uses.length
        ? uses.slice(0, 4).map(function (cast) { return L.formatTime(cast.time); }).join("  ") + (uses.length > 4 ? "  +" + (uses.length - 4) : "")
        : "這場還沒排";
      const meta = skill.cooldown + " 秒冷卻 · " + skill.duration + " 秒" + (skill.charges > 1 ? " · " + skill.charges + " 層" : "");
      main.appendChild(el("span", "skill-name", skill.name));
      main.appendChild(el("span", "skill-meta", meta));
      main.appendChild(el("span", "skill-when", when));
      card.appendChild(main);
      const label = state.pendingDelete === skill.id ? "連同施放一起刪" : "刪";
      card.appendChild(button("text-btn", label, "delete-skill", { id: skill.id }));
      list.appendChild(card);
    });
  }

  function renderBoard() {
    renderTimeline();
    renderCasts();
    renderMechs();
  }

  function renderTimeline() {
    const host = document.getElementById("timeline");
    const previous = host.querySelector(".ruler-scroll");
    const keep = previous ? previous.scrollLeft : 0;
    clear(host);
    const span = L.fightSpan(state.plan);
    const scroller = el("div", "ruler-scroll");
    const ruler = el("div", "ruler");
    ruler.id = "ruler";
    ruler.style.width = (span * PX) + "px";
    for (let t = 0; t <= span; t += 10) {
      const tick = el("span", "tick", L.formatTime(t));
      tick.style.left = (t * PX) + "px";
      ruler.appendChild(tick);
    }
    state.plan.mechanics.forEach(function (mech) {
      const mark = el("button", "mech-mark", mech.name);
      mark.type = "button";
      mark.dataset.mech = mech.id;
      mark.style.left = (mech.time * PX) + "px";
      mark.title = L.formatTime(mech.time) + " " + mech.name;
      ruler.appendChild(mark);
    });
    const issues = L.conflicts(state.plan);
    const laneEnds = [];
    let lanes = 1;
    L.sortedByTime(state.plan.casts).forEach(function (cast) {
      const skill = L.skillOf(state.plan, cast);
      const duration = skill ? Math.max(skill.duration, 3) : 4;
      let lane = -1;
      for (let i = 0; i < laneEnds.length; i += 1) {
        if (laneEnds[i] <= cast.time) { lane = i; break; }
      }
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = cast.time + duration;
      lanes = Math.max(lanes, lane + 1);
      const pill = el("button", "pill" + (issues[cast.id] ? " bad" : ""));
      pill.type = "button";
      pill.dataset.cast = cast.id;
      pill.style.left = (cast.time * PX) + "px";
      pill.style.top = (46 + lane * 38) + "px";
      pill.style.width = Math.max(duration * PX, 64) + "px";
      pill.style.setProperty("--c", colorFor(L.skillName(state.plan, cast)));
      pill.appendChild(el("span", "pill-time", L.formatTime(cast.time)));
      pill.appendChild(el("span", "pill-name", L.skillName(state.plan, cast)));
      ruler.appendChild(pill);
    });
    ruler.style.height = (58 + lanes * 38) + "px";
    scroller.appendChild(ruler);
    host.appendChild(scroller);
    scroller.scrollLeft = keep;
  }

  function renderCasts() {
    const list = document.getElementById("cast-list");
    clear(list);
    list.appendChild(adderForm());
    const issues = L.conflicts(state.plan);
    if (!state.plan.casts.length) {
      list.appendChild(el("p", "hint", "還沒有施放。點左邊的技能，再點時間軸。"));
      return;
    }
    if (state.group === "skill") {
      state.plan.skills.forEach(function (skill) {
        const uses = L.castsForSkill(state.plan, skill.id);
        list.appendChild(el("h2", "skill-head", skill.name));
        if (!uses.length) list.appendChild(el("p", "hint", "這場還沒排。"));
        uses.forEach(function (cast) { list.appendChild(castRow(cast, issues)); });
      });
      const missing = state.plan.casts.filter(function (cast) {
        return !state.plan.skills.some(function (skill) { return skill.id === cast.skillId; });
      });
      if (missing.length) {
        list.appendChild(el("h2", "skill-head", "已不在清單"));
        missing.forEach(function (cast) { list.appendChild(castRow(cast, issues)); });
      }
      return;
    }
    L.sortedByTime(state.plan.casts).forEach(function (cast) {
      list.appendChild(castRow(cast, issues));
    });
  }

  function adderForm() {
    const form = el("form", "adder");
    form.id = "adder";
    const time = document.createElement("input");
    time.type = "text";
    time.name = "time";
    time.placeholder = "0:32";
    time.setAttribute("aria-label", "要排進去的時間");
    time.autocomplete = "off";
    const select = document.createElement("select");
    select.name = "skill";
    select.setAttribute("aria-label", "要排的技能");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "選技能";
    select.appendChild(empty);
    state.plan.skills.forEach(function (skill) {
      const option = document.createElement("option");
      option.value = skill.id;
      option.textContent = skill.name;
      if (skill.id === state.armed) option.selected = true;
      select.appendChild(option);
    });
    const note = document.createElement("input");
    note.type = "text";
    note.name = "note";
    note.placeholder = "對照哪個機制";
    note.maxLength = 40;
    note.setAttribute("aria-label", "備註");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "排進去";
    form.appendChild(time);
    form.appendChild(select);
    form.appendChild(note);
    form.appendChild(submit);
    return form;
  }

  function castRow(cast, issues) {
    const row = el("div", "cast" + (issues[cast.id] ? " bad" : ""));
    const time = document.createElement("input");
    time.type = "text";
    time.value = L.formatEdit(cast.time);
    time.dataset.act = "cast-time";
    time.dataset.id = cast.id;
    time.setAttribute("aria-label", "按下時間");
    time.autocomplete = "off";
    const select = document.createElement("select");
    select.dataset.act = "cast-skill";
    select.dataset.id = cast.id;
    select.setAttribute("aria-label", "技能");
    let known = false;
    state.plan.skills.forEach(function (skill) {
      const option = document.createElement("option");
      option.value = skill.id;
      option.textContent = skill.name;
      if (skill.id === cast.skillId) {
        option.selected = true;
        known = true;
      }
      select.appendChild(option);
    });
    if (!known) {
      const option = document.createElement("option");
      option.value = cast.skillId;
      option.textContent = L.skillName(state.plan, cast);
      option.selected = true;
      select.appendChild(option);
    }
    const note = document.createElement("input");
    note.type = "text";
    note.value = cast.note || "";
    note.maxLength = 40;
    note.placeholder = "對照哪個機制";
    note.dataset.act = "cast-note";
    note.dataset.id = cast.id;
    note.setAttribute("aria-label", "備註");
    row.appendChild(time);
    row.appendChild(select);
    row.appendChild(note);
    row.appendChild(button("text-btn", "−1秒", "nudge", { id: cast.id, by: "-1" }));
    row.appendChild(button("text-btn", "+1秒", "nudge", { id: cast.id, by: "1" }));
    row.appendChild(button("text-btn", "刪掉", "delete-cast", { id: cast.id }));
    if (issues[cast.id]) row.appendChild(el("span", "warn", "冷卻還差 " + Math.ceil(issues[cast.id].short) + " 秒"));
    return row;
  }

  function renderMechs() {
    const list = document.getElementById("mech-list");
    clear(list);
    if (!state.plan.mechanics.length) {
      list.appendChild(el("p", "hint", "沒有機制也沒關係，只排技能時間就夠。"));
      return;
    }
    state.plan.mechanics.forEach(function (mech) {
      const row = el("div", "cast");
      const time = document.createElement("input");
      time.type = "text";
      time.value = L.formatEdit(mech.time);
      time.dataset.act = "mech-time";
      time.dataset.id = mech.id;
      time.setAttribute("aria-label", "機制時間");
      const name = document.createElement("input");
      name.type = "text";
      name.value = mech.name;
      name.dataset.act = "mech-name";
      name.dataset.id = mech.id;
      name.setAttribute("aria-label", "機制名稱");
      row.appendChild(time);
      row.appendChild(name);
      if (state.armed) row.appendChild(button("text-btn", "放在這裡", "place-mech", { id: mech.id }));
      row.appendChild(button("text-btn", "刪掉", "delete-mech", { id: mech.id }));
      list.appendChild(row);
    });
  }

  function renderSheetList() {
    const list = document.getElementById("sheet-list");
    clear(list);
    const issues = L.conflicts(state.plan);
    L.sortedByTime(state.plan.casts).forEach(function (cast) {
      const item = el("li", "future");
      item.dataset.id = cast.id;
      item.appendChild(el("span", "t", L.formatTime(cast.time)));
      item.appendChild(el("span", "n", L.skillName(state.plan, cast)));
      item.appendChild(el("span", "m", cast.note || ""));
      if (issues[cast.id]) item.appendChild(el("span", "bad", "冷卻還差 " + Math.ceil(issues[cast.id].short) + " 秒"));
      list.appendChild(item);
    });
  }

  function onClick(event) {
    if (state.suppressClick) return;
    const node = event.target.closest("[data-act]");
    if (!node || node.closest("#timeline")) return;
    const act = node.dataset.act;
    const id = node.dataset.id;
    if (act === "mode") setMode(node.dataset.mode);
    else if (act === "group") {
      state.group = node.dataset.group === "skill" ? "skill" : "time";
      saveUi();
      updateGroupButtons();
      renderCasts();
    } else if (act === "arm") {
      state.armed = state.armed === id ? null : id;
      state.pendingDelete = null;
      renderSkills();
      renderMechs();
      updateArmHint();
    } else if (act === "delete-skill") deleteSkill(id);
    else if (act === "delete-cast") {
      state.plan.casts = state.plan.casts.filter(function (cast) { return cast.id !== id; });
      touch();
    } else if (act === "delete-mech") {
      state.plan.mechanics = state.plan.mechanics.filter(function (mech) { return mech.id !== id; });
      touch();
    } else if (act === "nudge") nudge(id, Number(node.dataset.by));
    else if (act === "place-mech") {
      const mech = state.plan.mechanics.find(function (item) { return item.id === id; });
      if (mech) placeArmed(mech.time, mech.name);
    } else if (act === "load-job") loadJob();
    else if (act === "clear") clearPlan();
    else if (act === "copy") copySheet();
    else if (act === "download") downloadKind(node.dataset.kind);
    else if (act === "import") document.getElementById("import-file").click();
    else if (act === "mit-go") importMit();
    else if (act === "mit-cancel") cancelMit();
    else if (act === "paste-add") pasteMechanics(false);
    else if (act === "paste-replace") pasteMechanics(true);
    else if (act === "practice") startPractice();
    else if (act === "pause") pausePractice();
    else if (act === "reset-clock") resetClock();
  }

  function onChange(event) {
    const node = event.target;
    const act = node.dataset.act;
    const id = node.dataset.id;
    if (act === "cast-time") {
      const cast = findCast(id);
      const time = L.parseTime(node.value);
      if (!cast) return;
      if (time == null) {
        setStatus("時間看不懂。用 1:05 或 65。");
        node.value = L.formatEdit(cast.time);
        return;
      }
      cast.time = time;
      state.plan.casts = L.sortedByTime(state.plan.casts);
      touch();
    } else if (act === "cast-skill") {
      const cast = findCast(id);
      if (!cast) return;
      cast.skillId = node.value;
      cast.skillName = "";
      touch();
    } else if (act === "cast-note") {
      const cast = findCast(id);
      if (!cast) return;
      cast.note = node.value.trim();
      touch();
    } else if (act === "mech-time") {
      const mech = state.plan.mechanics.find(function (item) { return item.id === id; });
      const time = L.parseTime(node.value);
      if (!mech) return;
      if (time == null) {
        setStatus("時間看不懂。用 1:05 或 65。");
        node.value = L.formatEdit(mech.time);
        return;
      }
      mech.time = time;
      state.plan.mechanics = L.sortedByTime(state.plan.mechanics);
      touch();
    } else if (act === "mit-raid") {
      fillMitRoles();
    } else if (act === "mech-name") {
      const mech = state.plan.mechanics.find(function (item) { return item.id === id; });
      if (!mech) return;
      mech.name = node.value.trim() || mech.name;
      touch();
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (form.id === "skill-form") {
      const skill = L.addSkill(state.plan, {
        name: form.elements.name.value,
        cooldown: form.elements.cooldown.value,
        duration: form.elements.duration.value,
        charges: form.elements.charges.value
      });
      if (!skill) {
        setStatus("技能名稱、冷卻和持續時間要填對。");
        return;
      }
      form.elements.name.value = "";
      state.armed = skill.id;
      touch();
    } else if (form.id === "mech-form") {
      const time = L.parseTime(form.elements.time.value);
      const name = form.elements.name.value.trim();
      if (time == null || !name) {
        setStatus("機制要有時間和名稱。時間用 0:32 或 32。");
        return;
      }
      state.plan.mechanics.push({ id: L.createId(), time: time, name: name });
      state.plan.mechanics = L.sortedByTime(state.plan.mechanics);
      state.plan.demo = false;
      form.elements.time.value = "";
      form.elements.name.value = "";
      touch();
    } else if (form.id === "adder") {
      const time = L.parseTime(form.elements.time.value);
      const skillId = form.elements.skill.value;
      if (time == null || !skillId) {
        setStatus("先選技能，時間用 0:32 或 32。");
        return;
      }
      const cast = L.addCast(state.plan, { time: time, skillId: skillId, note: form.elements.note.value });
      if (!cast) setStatus("這個時間已經排了這一招。");
      else touch();
    }
  }

  function onPointerDown(event) {
    const castEl = event.target.closest("[data-cast]");
    if (!castEl) return;
    const cast = findCast(castEl.dataset.cast);
    if (!cast) return;
    const originX = event.clientX;
    const originTime = cast.time;
    let moved = false;
    function move(e) {
      const delta = Math.round((e.clientX - originX) / PX);
      if (delta !== 0) moved = true;
      const time = originTime + delta;
      castEl.style.left = (time * PX) + "px";
      const label = castEl.querySelector(".pill-time");
      if (label) label.textContent = L.formatTime(time);
      castEl.dataset.dragTime = String(time);
    }
    function up() {
      castEl.removeEventListener("pointermove", move);
      castEl.removeEventListener("pointerup", up);
      if (!moved) return;
      state.suppressClick = true;
      setTimeout(function () { state.suppressClick = false; }, 0);
      const next = Number(castEl.dataset.dragTime);
      if (!Number.isFinite(next) || next === originTime) return;
      cast.time = next;
      state.plan.casts = L.sortedByTime(state.plan.casts);
      touch();
    }
    castEl.addEventListener("pointermove", move);
    castEl.addEventListener("pointerup", up);
  }

  function onTimelineClick(event) {
    if (state.suppressClick) return;
    const castEl = event.target.closest("[data-cast]");
    if (castEl) {
      const cast = findCast(castEl.dataset.cast);
      if (!cast) return;
      state.armed = cast.skillId;
      renderSkills();
      renderMechs();
      updateArmHint();
      return;
    }
    const mechEl = event.target.closest("[data-mech]");
    if (mechEl) {
      if (!state.armed) {
        setStatus("先點左邊要排的技能。");
        return;
      }
      const mech = state.plan.mechanics.find(function (item) { return item.id === mechEl.dataset.mech; });
      if (mech) placeArmed(mech.time, mech.name);
      return;
    }
    if (!state.armed || !event.target.closest("#ruler")) return;
    const ruler = document.getElementById("ruler");
    const x = event.clientX - ruler.getBoundingClientRect().left;
    placeArmed(Math.max(0, Math.round(x / PX)));
  }

  function placeArmed(time, note) {
    if (!state.armed) return;
    const text = note != null ? note : (function () {
      const mech = L.nearestMechanic(state.plan, time);
      return mech ? mech.name : "";
    })();
    const cast = L.addCast(state.plan, { time: time, skillId: state.armed, note: text });
    if (!cast) {
      const skill = state.plan.skills.find(function (item) { return item.id === state.armed; });
      setStatus("這個時間已經排了" + (skill ? skill.name : "這一招") + "。");
      return;
    }
    touch();
  }

  function nudge(id, by) {
    const cast = findCast(id);
    if (!cast || !Number.isFinite(by)) return;
    cast.time = Math.round((cast.time + by) * 10) / 10;
    state.plan.casts = L.sortedByTime(state.plan.casts);
    touch();
  }

  function deleteSkill(id) {
    const used = state.plan.casts.some(function (cast) { return cast.skillId === id; });
    if (used && state.pendingDelete !== id) {
      state.pendingDelete = id;
      renderSkills();
      return;
    }
    state.plan.skills = state.plan.skills.filter(function (item) { return item.id !== id; });
    state.plan.casts = state.plan.casts.filter(function (cast) { return cast.skillId !== id; });
    if (state.armed === id) state.armed = null;
    state.pendingDelete = null;
    touch();
  }

  function loadJob() {
    const job = Skills.byId(jobSelect.value);
    if (!job) return;
    L.applyJob(state.plan, job);
    state.armed = null;
    state.pendingDelete = null;
    touch();
    setStatus("已載入" + job.name + "的技能。");
  }

  function clearPlan() {
    state.plan.name = "";
    state.plan.mechanics = [];
    state.plan.casts = [];
    state.plan.demo = false;
    state.armed = null;
    fightName.value = "";
    document.title = "排軸小抄";
    touch();
  }

  function pasteMechanics(replace) {
    const parsed = L.parseMechanics(document.getElementById("paste").value);
    if (!parsed.length) {
      setStatus("沒讀到機制。一行一個，例如 0:32 雙重攻擊。");
      return;
    }
    const next = parsed.map(function (item) {
      return { id: L.createId(), time: item.time, name: item.name };
    });
    state.plan.mechanics = replace ? next : state.plan.mechanics.concat(next);
    state.plan.mechanics = L.sortedByTime(state.plan.mechanics);
    state.plan.demo = false;
    touch();
    setStatus((replace ? "已改成 " : "已加入 ") + parsed.length + " 個機制。");
  }

  function touch() {
    state.plan.demo = false;
    persist();
    renderAll();
  }

  function copySheet() {
    const text = L.cheatSheetText(state.plan);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus("小抄已複製。");
      }, function () {
        download("小抄.txt", text);
        setStatus("複製失敗，已改下載文字檔。");
      });
      return;
    }
    download(L.safeFile(state.plan.name) + " 小抄.txt", text);
  }

  function downloadKind(kind) {
    const name = L.safeFile(state.plan.name);
    if (kind === "json") download(name + ".json", L.exportJson(state.plan), "application/json");
    else if (kind === "text") download(name + " 小抄.txt", L.cheatSheetText(state.plan));
    else if (kind === "macro") download(name + " 巨集.txt", L.macroText(state.plan));
    else if (kind === "act") download(name + " Triggernometry.xml", L.triggerXml(state.plan), "application/xml");
    else if (kind === "cactbot") download(name + " cactbot.txt", L.cactbotText(state.plan));
    if (!state.plan.casts.length && kind !== "json") setStatus("還沒排技能，檔案裡不會有提醒。");
  }

  function onImport(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      let raw;
      try { raw = JSON.parse(String(reader.result).replace(/^\uFEFF/, "")); }
      catch (error) { setStatus("這個檔案不是排軸檔", 12000); return; }
      if (L.isMitBackup(raw)) {
        const choices = L.mitBackupChoices(raw);
        if (!choices.raids.length) {
          setStatus("這份備份裡還沒有排好的技能。", 12000);
          return;
        }
        state.mitBackup = raw;
        state.mitChoices = choices;
        showMitPicker();
        importMit();
        return;
      }
      try {
        state.plan = L.importJson(JSON.stringify(raw));
        state.armed = null;
        persist();
        fillStatic();
        renderAll();
        setStatus("已匯入" + (state.plan.name || "排軸") + "。");
      } catch (error) {
        setStatus(error.message || "匯入失敗");
      }
    };
    reader.readAsText(file);
  }

  function showMitPicker() {
    document.getElementById("mit-import").hidden = false;
    fillMitRaids();
    setMode("plan");
    if (location.protocol === "file:") return;
    fetchJson(mitUrl("raids.json")).then(function (manifest) {
      state.mitNames = {};
      (manifest.raids || []).forEach(function (raid) {
        state.mitNames[raid.id] = raid.shortName || raid.name || raid.id;
      });
      if (state.mitBackup) fillMitRaids();
    }).catch(function () { /* 沒連上就先用副本代號 */ });
  }

  function fillMitRaids() {
    const select = document.getElementById("mit-raid");
    const current = select.value || (state.mitChoices && state.mitChoices.defaultRaid) || "";
    clear(select);
    (state.mitChoices.raids || []).forEach(function (raid) {
      const option = document.createElement("option");
      option.value = raid.id;
      const label = (state.mitNames && state.mitNames[raid.id]) || raid.id;
      option.textContent = label + "（" + raid.casts + "）";
      select.appendChild(option);
    });
    const ids = state.mitChoices.raids.map(function (raid) { return raid.id; });
    select.value = ids.indexOf(current) >= 0 ? current : state.mitChoices.defaultRaid;
    fillMitRoles();
  }

  function fillMitRoles() {
    const raidId = document.getElementById("mit-raid").value;
    const raid = (state.mitChoices.raids || []).find(function (item) { return item.id === raidId; });
    const select = document.getElementById("mit-role");
    const previous = select.value;
    clear(select);
    if (!raid) return;
    raid.roles.forEach(function (role) {
      const option = document.createElement("option");
      option.value = role.role;
      const known = Skills.byId(role.job);
      const jobName = known ? known.name : role.job;
      option.textContent = role.role + (jobName ? " " + jobName : "") + "（" + role.casts + "）";
      select.appendChild(option);
    });
    const roles = raid.roles.map(function (role) { return role.role; });
    if (roles.indexOf(previous) >= 0) select.value = previous;
    else if (roles.indexOf(state.mitChoices.defaultRole) >= 0) select.value = state.mitChoices.defaultRole;
    else select.value = roles[0];
  }

  function cancelMit() {
    state.mitBackup = null;
    document.getElementById("mit-import").hidden = true;
  }

  function importMit() {
    const backup = state.mitBackup;
    const raidId = document.getElementById("mit-raid").value;
    const role = document.getElementById("mit-role").value;
    if (!backup || !raidId || !role) return;
    if (location.protocol === "file:") {
      setStatus("請先雙擊 start.bat，用瀏覽器開 http://127.0.0.1:8766/ 再匯入。直接開檔案讀不到機制名稱。", 12000);
      return;
    }
    const button = document.querySelector('[data-act="mit-go"]');
    button.disabled = true;
    setStatus("正在讀時間軸…", 20000);
    loadMitBundle(raidId).then(function (bundle) {
      if (state.mitBackup !== backup) return;
      const raid = state.mitChoices.raids.find(function (item) { return item.id === raidId; });
      const roleRow = raid && raid.roles.find(function (item) { return item.role === role; });
      const known = roleRow && Skills.byId(roleRow.job);
      bundle.jobLabel = known ? known.name : ((roleRow && roleRow.job) || "");
      state.plan = L.mitPlanFromBackup(backup, raidId, role, bundle);
      const skipped = state.plan.skippedOtherJob || 0;
      const brought = state.plan.name + "，" + state.plan.casts.length + " 次施放。";
      state.armed = null;
      persist();
      fillStatic();
      setMode("plan");
      renderAll();
      setStatus(skipped
        ? "已帶入" + brought + "另外 " + skipped + " 次是這個位置上其他職業的技能，沒帶進來。"
        : "已帶入" + brought, 12000);
    }).catch(function (error) {
      const message = error && error.message ? error.message : "";
      if (message.indexOf("時間軸") >= 0 || message.indexOf("沒有") >= 0 || message.indexOf("備份") >= 0 || message.indexOf("start.bat") >= 0) setStatus(message, 12000);
      else setStatus("讀不到時間軸。請確認 start.bat 還開著，並連上網。機制名稱要向 mit.xivtc.com 要。", 12000);
    }).then(function () {
      button.disabled = false;
    });
  }

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("讀取失敗 " + res.status);
      return res.json();
    });
  }

  function mitUrl(rel) {
    return "/api/mit/" + String(rel || "").replace(/^\/+/, "");
  }

  function loadMitBundle(raidId) {
    if (location.protocol === "file:") {
      return Promise.reject(new Error("請先雙擊 start.bat，用瀏覽器開 http://127.0.0.1:8766/ 再匯入。"));
    }
    return fetchJson(mitUrl("raids.json")).then(function (manifest) {
      const raid = (manifest.raids || []).find(function (item) { return item.id === raidId; });
      if (!raid) throw new Error("減傷表沒有這個副本");
      const phaseIds = (raid.phases || []).map(function (phase) { return phase.id; });
      return Promise.all([
        fetchJson(mitUrl("raids/" + raidId + "/skills.json")),
        Promise.all(phaseIds.map(function (id) {
          return fetchJson(mitUrl("raids/" + raidId + "/timeline/" + id + ".json")).then(function (body) {
            return [id, body];
          }).catch(function () {
            return [id, { actions: [] }];
          });
        }))
      ]).then(function (parts) {
        const phases = {};
        parts[1].forEach(function (pair) { phases[pair[0]] = pair[1]; });
        return { raid: raid, skills: parts[0].skills || [], phases: phases };
      });
    });
  }

  function elapsed() {
    if (state.clock.paused != null) return state.clock.paused;
    if (state.clock.zeroAt == null) return null;
    return (Date.now() - state.clock.zeroAt) / 1000;
  }

  function startPractice() {
    if (state.clock.source === "act" && state.clock.zeroAt != null) {
      setStatus("ACT 正在同步。要自己練，先按重來。");
      return;
    }
    state.clock = { zeroAt: Date.now(), paused: null, source: "practice" };
    state.lastFocusId = null;
    setMode("sheet");
    ensureTick();
  }

  function pausePractice() {
    const now = elapsed();
    if (now == null) return;
    if (state.clock.source === "act") {
      setStatus("ACT 同步中，暫停不會停掉戰鬥時間。");
      return;
    }
    state.clock.paused = now;
    state.clock.zeroAt = null;
    paintSheet();
  }

  function resetClock() {
    state.clock = { zeroAt: null, paused: null, source: "idle" };
    state.lastFocusId = null;
    paintSheet();
  }

  function ensureTick() {
    if (state.ticking || state.clock.zeroAt == null) return;
    state.ticking = true;
    const loop = function () {
      paintSheet();
      if (state.clock.zeroAt != null && state.clock.paused == null) requestAnimationFrame(loop);
      else state.ticking = false;
    };
    requestAnimationFrame(loop);
  }

  function paintSheet() {
    const now = elapsed();
    const casts = L.sortedByTime(state.plan.casts);
    const lead = state.plan.leadSec;
    const issues = L.conflicts(state.plan);
    const clock = document.getElementById("clock");
    const actStatus = document.getElementById("act-status");
    if (now == null) {
      clock.textContent = "--:--";
      actStatus.textContent = state.overlay ? "已接上 ACT，等倒數" : "尚未開始";
    } else {
      clock.textContent = L.formatTime(now);
      actStatus.textContent = state.clock.source === "act" ? "ACT 同步中" : "練習計時";
    }
    const focus = now == null ? (casts[0] || null) : L.focusCast(casts, now, lead);
    const phase = now == null ? (focus ? "idle" : "done") : L.phaseOf(focus, now, lead);
    const hero = document.getElementById("hero");
    hero.className = "hero " + (phase === "idle" ? "wait" : phase);
    const kicker = document.getElementById("hero-kicker");
    const skill = document.getElementById("hero-skill");
    const note = document.getElementById("hero-note");
    const warn = document.getElementById("hero-warn");
    if (!focus) {
      kicker.textContent = casts.length ? "這段結束" : "還沒排技能";
      skill.textContent = casts.length ? "沒有下一招" : "先回排軸";
      note.textContent = "";
      warn.textContent = "";
    } else {
      if (now == null) kicker.textContent = "第一招";
      else if (phase === "now") kicker.textContent = "現在";
      else if (phase === "ready") kicker.textContent = "準備";
      else kicker.textContent = "還有 " + Math.max(0, Math.ceil(focus.time - now)) + " 秒";
      skill.textContent = L.skillName(state.plan, focus);
      note.textContent = focus.note || "";
      warn.textContent = issues[focus.id] ? "這次排太早，冷卻還差 " + Math.ceil(issues[focus.id].short) + " 秒" : "";
    }
    const items = document.querySelectorAll("#sheet-list li");
    items.forEach(function (item) {
      const cast = casts.find(function (entry) { return entry.id === item.dataset.id; });
      if (!cast) return;
      item.classList.remove("past", "current", "future");
      if (now != null && focus && cast.id === focus.id && (phase === "now" || phase === "ready")) item.classList.add("current");
      else if (now != null && cast.time + L.HOLD_SEC < now) item.classList.add("past");
      else item.classList.add("future");
    });
    if (focus && focus.id !== state.lastFocusId) {
      state.lastFocusId = focus.id;
      const current = document.querySelector('#sheet-list li[data-id="' + cssAttr(focus.id) + '"]');
      if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
    }
  }

  function adoptActClock(zeroAt) {
    state.clock = { zeroAt: zeroAt, paused: null, source: "act" };
    if (state.mode !== "sheet") setMode("sheet");
    else {
      paintSheet();
      ensureTick();
    }
  }

  function syncCountdown(seconds) {
    adoptActClock(Date.now() + seconds * 1000);
  }

  function syncEngage() {
    adoptActClock(Date.now());
  }

  function watchOverlay() {
    let tries = 0;
    const timer = setInterval(function () {
      tries += 1;
      if (hookOverlay() || tries > 20) clearInterval(timer);
    }, 500);
  }

  function logTexts(data) {
    const parts = data && data.line ? data.line : [];
    const raw = (data && data.rawLine) || "";
    const code = parts.length > 2 ? String(parts[2]) : "";
    const msg = parts.length ? String(parts[parts.length - 1]) : "";
    const texts = [];
    if (raw) texts.push(raw);
    if (parts.length) texts.push(parts.join("|"));
    if (code && msg) texts.push("00:" + code + "::" + msg);
    return texts;
  }

  function hookOverlay() {
    if (state.overlayHooked) return true;
    if (typeof window.addOverlayListener !== "function" || typeof window.startOverlayEvents !== "function") return false;
    state.overlayHooked = true;
    window.addOverlayListener("LogLine", function (data) {
      const texts = logTexts(data);
      let seconds = null;
      for (let i = 0; i < texts.length; i += 1) {
        seconds = L.parseCountdown(texts[i]);
        if (seconds != null) break;
      }
      if (seconds != null) {
        syncCountdown(seconds);
        return;
      }
      for (let j = 0; j < texts.length; j += 1) {
        if (L.parseEngage(texts[j])) {
          syncEngage();
          return;
        }
      }
    });
    try { window.startOverlayEvents(); }
    catch (error) { /* 監聽已經掛上，就算啟動事件失敗，下一條日誌仍會試。 */ }
    state.overlay = true;
    document.body.classList.add("as-overlay");
    setMode("sheet");
    paintSheet();
    return true;
  }

  function onKey(event) {
    const field = event.target && event.target.closest && event.target.closest("input, textarea, select");
    if (field) return;
    if (state.mode !== "sheet") return;
    if (event.code === "Space" && event.target && event.target.closest && event.target.closest("button")) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (state.clock.zeroAt != null && state.clock.paused == null) pausePractice();
      else if (state.clock.paused != null) resumePractice();
      else startPractice();
    } else if (event.key === "r" || event.key === "R") resetClock();
  }

  function resumePractice() {
    if (state.clock.source === "act") return;
    const paused = state.clock.paused;
    state.clock = { zeroAt: Date.now() - paused * 1000, paused: null, source: "practice" };
    ensureTick();
  }

  function findCast(id) {
    return state.plan.casts.find(function (cast) { return cast.id === id; }) || null;
  }

  let statusTimer = 0;
  function setStatus(text, ms) {
    const node = document.getElementById("status");
    node.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { node.textContent = ""; }, ms || 4500);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function colorFor(name) {
    let hash = 0;
    const text = String(name || "");
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return COLORS[hash % COLORS.length];
  }

  function cssAttr(id) {
    if (window.CSS && CSS.escape) return CSS.escape(id);
    return String(id).replace(/"/g, "");
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, text, act, extra) {
    const node = el("button", className, text);
    node.type = "button";
    node.dataset.act = act;
    if (extra) {
      Object.keys(extra).forEach(function (key) { node.dataset[key] = extra[key]; });
    }
    return node;
  }
})();
