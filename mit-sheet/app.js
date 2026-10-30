/* 排軸小抄的畫面。資料存在這個網址的 localStorage。 */
(function () {
  "use strict";

  const L = window.MitLogic;
  const Skills = window.MitSkills;
  const STORAGE = "mit-sheet:v1";
  const UIKEY = "mit-sheet:ui";
  const BACKUP = "mit-sheet:backup";
  const LIBRARIES = "mit-sheet:libraries";
  const PX = 12;
  const COLORS = ["#e2b86a", "#d7eccf", "#e08b7a", "#9ec3e6", "#d7b8e6", "#f0d2a0", "#c9d6a3"];

  const ui = loadUi();
  const state = {
    plan: loadPlan(),
    armed: null,
    mode: "plan",
    group: ui.group === "skill" ? "skill" : "time",
    overlay: false,
    overlayHooked: false,
    preview: false,
    suppressClick: false,
    clock: { zeroAt: null, paused: null, source: "idle" },
    lastFocusId: null,
    pendingDelete: null,
    ticking: false,
    nextKey: "",
    mitBackup: null,
    mitChoices: null,
    mitNames: {},
    libraries: [],
    libraryId: ""
  };

  const fightName = document.getElementById("fight-name");
  const fightButton = document.getElementById("fight");
  const leadInput = document.getElementById("lead");
  const jobSelect = document.getElementById("job");
  const sheetJob = document.getElementById("sheet-job");

  bind();
  fillJobs();
  fillStatic();
  restoreLibraries();
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
    if (fightName) {
      fightName.addEventListener("input", function () {
        state.plan.name = fightName.value;
        state.plan.demo = false;
        persist();
        updateDemoNote();
        document.title = state.plan.name ? state.plan.name + " · 排軸小抄" : "排軸小抄";
      });
    }
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
    const sheetMenu = document.getElementById("sheet-job-menu");
    const planMenu = document.getElementById("plan-job-menu");
    clear(sheetMenu);
    clear(planMenu);
    const raid = currentRaid();
    const rows = raid ? jobRows(raid) : [];
    if (rows.length) {
      const seen = {};
      rows.forEach(function (row) {
        if (seen[row.job]) return;
        seen[row.job] = true;
        const known = Skills.byId(row.job);
        const name = known ? known.name : row.job;
        sheetMenu.appendChild(button("job-choice", name, "pick-job", { id: row.job }));
        planMenu.appendChild(button("job-choice", name, "pick-plan-job", { id: row.job }));
      });
    } else {
      let groupName = "";
      Skills.jobs.forEach(function (job) {
        if (job.group !== groupName) {
          sheetMenu.appendChild(el("p", "job-group", job.group));
          planMenu.appendChild(el("p", "job-group", job.group));
          groupName = job.group;
        }
        sheetMenu.appendChild(button("job-choice", job.name, "pick-job", { id: job.id }));
        planMenu.appendChild(button("job-choice", job.name, "pick-plan-job", { id: job.id }));
      });
    }
    if (state.plan.jobId) {
      setPlanJob(state.plan.jobId);
      setSheetJob(state.plan.jobId);
    }
  }

  function setSheetJob(id) {
    const job = Skills.byId(id);
    sheetJob.dataset.job = job ? job.id : "";
    sheetJob.textContent = job ? job.name : "選職業";
    document.querySelectorAll("#sheet-job-menu .job-choice").forEach(function (node) {
      node.classList.toggle("on", node.dataset.id === sheetJob.dataset.job);
    });
  }

  function setPlanJob(id) {
    const job = Skills.byId(id);
    jobSelect.dataset.job = job ? job.id : "";
    jobSelect.textContent = job ? job.name : "選職業";
    document.querySelectorAll("#plan-job-menu .job-choice").forEach(function (node) {
      node.classList.toggle("on", node.dataset.id === jobSelect.dataset.job);
    });
  }

  function closeMenus() {
    document.querySelectorAll(".job-menu").forEach(function (menu) {
      menu.hidden = true;
    });
    document.querySelectorAll(".job-pick > button").forEach(function (node) {
      node.setAttribute("aria-expanded", "false");
    });
  }

  function toggleMenu(trigger, menu) {
    const willOpen = !!(menu && menu.hidden);
    closeMenus();
    if (!willOpen || !menu || !trigger) return;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  }

  function fillStatic() {
    setFightLabel();
    leadInput.value = String(state.plan.leadSec);
    if (state.plan.jobId && Skills.byId(state.plan.jobId)) {
      setPlanJob(state.plan.jobId);
      setSheetJob(state.plan.jobId);
    }
    document.title = state.plan.name ? state.plan.name + " · 排軸小抄" : "排軸小抄";
    updateDemoNote();
  }

  function setFightLabel() {
    if (fightButton) fightButton.textContent = state.plan.name || "選這場";
    if (fightName) fightName.value = state.plan.name || "";
    document.title = state.plan.name ? state.plan.name + " · 排軸小抄" : "排軸小抄";
    const key = axisKey(state.libraryId || state.plan.libraryId, state.plan.raidId, state.plan.role, state.plan.jobId);
    document.querySelectorAll("#fight-menu .job-choice").forEach(function (node) {
      node.classList.toggle("on", node.dataset.id === key);
    });
  }

  function showOrigin() {
    const node = document.getElementById("origin-url");
    if (!node) return;
    if (location.protocol === "file:") {
      node.textContent = "http://127.0.0.1:8766/?v=10";
      return;
    }
    const url = new URL(location.href);
    url.search = "v=10";
    url.hash = "";
    node.textContent = url.toString();
  }

  function setMode(mode) {
    state.mode = mode === "sheet" ? "sheet" : "plan";
    document.body.classList.toggle("mode-sheet", state.mode === "sheet");
    document.body.classList.toggle("mode-plan", state.mode === "plan");
    document.getElementById("plan").hidden = state.mode !== "plan";
    document.getElementById("sheet").hidden = state.mode !== "sheet";
    const planBtn = document.getElementById("mode-plan");
    const sheetBtn = document.getElementById("mode-sheet");
    if (planBtn) planBtn.setAttribute("aria-pressed", String(state.mode === "plan"));
    if (sheetBtn) sheetBtn.setAttribute("aria-pressed", String(state.mode === "sheet"));
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
    const node = document.getElementById("arm-hint");
    if (!node) return;
    const skill = state.plan.skills.find(function (item) { return item.id === state.armed; });
    node.textContent = skill
      ? "正在排「" + skill.name + "」。點時間軸、機制，或下面的時間。"
      : "先點左邊的技能，再點時間軸或機制。";
  }

  function updateGroupButtons() {
    document.getElementById("group-time").setAttribute("aria-pressed", String(state.group === "time"));
    document.getElementById("group-skill").setAttribute("aria-pressed", String(state.group === "skill"));
  }

  function renderSkills() {
    const list = document.getElementById("skill-list");
    if (!list) return;
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
      list.appendChild(el("p", "hint", "這個職業還沒有排技能。"));
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
    if (!list) return;
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
    if (!event.target.closest || !event.target.closest(".job-pick")) closeMenus();
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
    else if (act === "preview") {
      if (state.preview) endPreview();
      else startPreview();
    } else if (act === "job-menu") toggleMenu(sheetJob, document.getElementById("sheet-job-menu"));
    else if (act === "pick-job") {
      setSheetJob(id);
      closeMenus();
      loadJobForSheet();
    } else if (act === "plan-job-menu") toggleMenu(jobSelect, document.getElementById("plan-job-menu"));
    else if (act === "pick-plan-job") {
      setPlanJob(id);
      setSheetJob(id);
      closeMenus();
      loadJobForSheet(false);
    } else if (act === "fight-menu") toggleMenu(fightButton, document.getElementById("fight-menu"));
    else if (act === "pick-fight") {
      closeMenus();
      pickFight(id);
    } else if (act === "mit-raid-menu") {
      const raidButton = document.getElementById("mit-raid");
      if (raidButton) toggleMenu(raidButton, document.getElementById("mit-raid-menu"));
    }
    else if (act === "pick-raid") {
      closeMenus();
      setMitRaid(id);
    } else if (act === "mit-job-menu") toggleMenu(document.getElementById("mit-job"), document.getElementById("mit-job-menu"));
    else if (act === "pick-mit-job") {
      closeMenus();
      setMitJob(id);
    } else if (act === "show-mit") {
      if (state.mitBackup && state.mitChoices) showMitPicker();
    }
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
    const job = Skills.byId(jobSelect.dataset.job);
    if (!job) {
      setStatus("先選職業。");
      return;
    }
    L.applyJob(state.plan, job);
    setPlanJob(job.id);
    setSheetJob(job.id);
    state.armed = null;
    state.pendingDelete = null;
    touch();
    setStatus("已載入" + job.name + "的 " + state.plan.skills.length + " 個技能。");
    setSheetMsg("");
  }

  function loadJobForSheet(keepSheet) {
    const picked = keepSheet === false ? jobSelect.dataset.job : sheetJob.dataset.job;
    const job = Skills.byId(picked);
    if (!job) return;
    if (state.mitBackup && state.mitChoices) {
      const axis = axisForJob(job.id);
      if (!axis) {
        setSheetJob(state.plan.jobId);
        setPlanJob(state.plan.jobId);
        setSheetMsg("這場備份沒有" + job.name + "的排軸。");
        return;
      }
      const sameAxis = state.plan.raidId === axis.raidId && state.plan.role === axis.role && state.plan.jobId === axis.job;
      const leftover = (state.plan.casts || []).some(function (cast) { return cast.skillName; });
      if (sameAxis && state.plan.casts.length && !leftover) return;
      importAxis(axis.raidId, axis.role, axis.job, keepSheet !== false);
      return;
    }
    const wasDemo = state.plan.demo === true;
    setPlanJob(job.id);
    L.applyJob(state.plan, job);
    const ids = {};
    state.plan.skills.forEach(function (skill) { ids[skill.id] = true; });
    state.plan.casts = state.plan.casts.filter(function (cast) { return ids[cast.skillId]; });
    state.plan.mechanics = [];
    if (!state.plan.casts.length) state.plan.casts = sampleCasts(state.plan.skills);
    state.plan.name = renameJob(state.plan.name, job.name);
    if (wasDemo || state.plan.name === job.name) state.plan.name = job.name + " 預覽";
    setSheetMsg("畫面上改成" + job.name + "的技能。這不是備份裡的排軸。");
    state.armed = null;
    state.pendingDelete = null;
    state.nextKey = "";
    setFightLabel();
    touch();
  }

  function renameJob(name, jobName) {
    let text = String(name || "").trim();
    Skills.jobs.forEach(function (item) {
      const tail = " " + item.name;
      if (text.endsWith(tail)) text = text.slice(0, -tail.length).trim();
      else if (text === item.name) text = "";
    });
    text = text.replace(/ 預覽$/, "").trim();
    return (text ? text + " " : "") + jobName;
  }

  function currentRaidId() {
    const raids = (state.mitChoices && state.mitChoices.raids) || [];
    if (state.plan.raidId && raids.some(function (raid) { return raid.id === state.plan.raidId; })) return state.plan.raidId;
    const name = String(state.plan.name || "").toLowerCase();
    let found = "";
    raids.forEach(function (raid) {
      const label = ((state.mitNames && state.mitNames[raid.id]) || "").toLowerCase();
      if (label && name.indexOf(label) === 0 && label.length > found.length) found = raid.id;
    });
    if (found) return found;
    raids.forEach(function (raid) {
      if (name.indexOf(String(raid.id).toLowerCase()) >= 0) found = raid.id;
    });
    if (found) return found;
    const raidButton = document.getElementById("mit-raid");
    const picked = raidButton ? raidButton.dataset.raid : "";
    if (picked && raids.some(function (raid) { return raid.id === picked; })) return picked;
    return (state.mitChoices && state.mitChoices.defaultRaid) || "";
  }

  function currentRaid() {
    const raidId = currentRaidId();
    return ((state.mitChoices && state.mitChoices.raids) || []).find(function (item) { return item.id === raidId; }) || null;
  }

  function axisForJob(jobId) {
    const raidId = currentRaidId();
    const raid = ((state.mitChoices && state.mitChoices.raids) || []).find(function (item) { return item.id === raidId; });
    if (!raid) return null;
    const rows = jobRows(raid).filter(function (row) { return row.job === jobId; });
    if (!rows.length) return null;
    const named = String(state.plan.name || "").match(/\b(MT|ST|H1|H2|D1|D2|D3|D4)\b/);
    const role = state.plan.role || (named ? named[1] : "");
    const row = rows.find(function (item) { return item.role === role; }) || rows[0];
    return { raidId: raid.id, role: row.role, job: jobId };
  }

  function sampleCasts(skills) {
    const times = [8, 22, 40, 58];
    return skills.slice(0, 4).map(function (skill, index) {
      return { id: L.createId(), time: times[index], skillId: skill.id, note: "" };
    });
  }

  function setSheetMsg(text) {
    document.getElementById("sheet-msg").textContent = text || "";
  }

  function clearPlan() {
    state.plan.name = "";
    state.plan.mechanics = [];
    state.plan.casts = [];
    state.plan.demo = false;
    state.armed = null;
    setFightLabel();
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
        const lib = addLibrary(raw);
        if (!lib) {
          setStatus("這份備份裡還沒有排好的技能。", 12000);
          return;
        }
        fillFightMenu();
        fillJobs();
        const row = defaultRow(lib);
        const raid = (lib.choices.raids || []).find(function (item) { return item.id === lib.choices.defaultRaid; }) || lib.choices.raids[0];
        if (row && raid) importAxis(raid.id, row.role, row.job, false);
        const menu = document.getElementById("fight-menu");
        if (fightButton && menu) toggleMenu(fightButton, menu);
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
    const trigger = document.getElementById("mit-raid");
    const menu = document.getElementById("mit-raid-menu");
    const current = trigger.dataset.raid || (state.mitChoices && state.mitChoices.defaultRaid) || "";
    clear(menu);
    const raids = (state.mitChoices && state.mitChoices.raids) || [];
    raids.forEach(function (raid) {
      const label = (state.mitNames && state.mitNames[raid.id]) || raid.id;
      menu.appendChild(button("job-choice", label + "（" + raid.casts + "）", "pick-raid", { id: raid.id }));
    });
    const ids = raids.map(function (raid) { return raid.id; });
    const raidId = ids.indexOf(current) >= 0 ? current : ((state.mitChoices && state.mitChoices.defaultRaid) || "");
    setMitRaid(raidId);
  }

  function setMitRaid(raidId) {
    const trigger = document.getElementById("mit-raid");
    const raid = ((state.mitChoices && state.mitChoices.raids) || []).find(function (item) { return item.id === raidId; });
    trigger.dataset.raid = raid ? raid.id : "";
    const label = raid ? ((state.mitNames && state.mitNames[raid.id]) || raid.id) : "選 boss";
    trigger.textContent = label;
    document.querySelectorAll("#mit-raid-menu .job-choice").forEach(function (node) {
      node.classList.toggle("on", node.dataset.id === trigger.dataset.raid);
    });
    fillMitJobs();
  }

  function fillMitJobs() {
    const raidId = document.getElementById("mit-raid").dataset.raid;
    const raid = ((state.mitChoices && state.mitChoices.raids) || []).find(function (item) { return item.id === raidId; });
    const trigger = document.getElementById("mit-job");
    const menu = document.getElementById("mit-job-menu");
    const previous = trigger.dataset.pick || "";
    clear(menu);
    const rows = raid ? jobRows(raid) : [];
    rows.forEach(function (row) {
      menu.appendChild(button("job-choice", mitJobLabel(row), "pick-mit-job", { id: row.key }));
    });
    const keys = rows.map(function (row) { return row.key; });
    let pick = previous;
    if (keys.indexOf(pick) < 0) {
      const prefer = state.mitChoices && state.mitChoices.defaultJobKey;
      pick = (raidId === (state.mitChoices && state.mitChoices.defaultRaid) && keys.indexOf(prefer) >= 0) ? prefer : (keys[0] || "");
    }
    setMitJob(pick);
  }

  function jobRows(raid) {
    const source = raid.jobs && raid.jobs.length ? raid.jobs : (raid.roles || []).map(function (role) {
      return { role: role.role, job: role.job, casts: role.casts };
    });
    return source.map(function (row) {
      return { role: row.role, job: row.job || "", casts: row.casts, key: row.role + "|" + (row.job || "") };
    });
  }

  function mitJobLabel(row) {
    const known = Skills.byId(row.job);
    const jobName = known ? known.name : (row.job || "未標職業");
    return jobName + " " + row.role + "（" + row.casts + "）";
  }

  function setMitJob(key) {
    const trigger = document.getElementById("mit-job");
    trigger.dataset.pick = key || "";
    const parts = String(key || "").split("|");
    const role = parts[0] || "";
    const jobId = parts.slice(1).join("|");
    const known = Skills.byId(jobId);
    trigger.textContent = key ? ((known ? known.name : (jobId || "未標職業")) + " " + role) : "選職業";
    document.querySelectorAll("#mit-job-menu .job-choice").forEach(function (node) {
      node.classList.toggle("on", node.dataset.id === trigger.dataset.pick);
    });
  }

  function cancelMit() {
    document.getElementById("mit-import").hidden = true;
  }

  function saveBackup() {
    if (!state.mitBackup) return;
    try { localStorage.setItem(BACKUP, JSON.stringify(state.mitBackup)); }
    catch (error) { /* 備份太大就只留在這次開啟 */ }
  }

  function axisKey(libId, raidId, role, job) {
    return [libId || "", raidId || "", role || "", job || ""].join("|");
  }

  function addLibrary(backup) {
    const choices = L.mitBackupChoices(backup);
    if (!choices.raids.length) return null;
    const finger = JSON.stringify(backup.assignments || {});
    let lib = state.libraries.find(function (item) { return item.finger === finger; });
    if (!lib) {
      lib = { id: L.createId(), backup: backup, choices: choices, finger: finger };
      state.libraries.push(lib);
    } else {
      lib.backup = backup;
      lib.choices = choices;
    }
    state.libraryId = lib.id;
    state.mitBackup = backup;
    state.mitChoices = choices;
    saveLibraries();
    return lib;
  }

  function saveLibraries() {
    try {
      localStorage.setItem(LIBRARIES, JSON.stringify(state.libraries.map(function (lib) {
        return { id: lib.id, backup: lib.backup };
      })));
    } catch (error) { /* 太大就只留在這次開啟 */ }
  }

  function restoreLibraries() {
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem(LIBRARIES) || "[]"); }
    catch (error) { rows = []; }
    if (!Array.isArray(rows) || !rows.length) {
      try {
        const old = JSON.parse(localStorage.getItem(BACKUP) || "null");
        if (L.isMitBackup(old)) rows = [{ id: "saved", backup: old }];
      } catch (error) { rows = []; }
    }
    state.libraries = [];
    (rows || []).forEach(function (item) {
      if (!item || !L.isMitBackup(item.backup)) return;
      const choices = L.mitBackupChoices(item.backup);
      if (!choices.raids.length) return;
      state.libraries.push({
        id: item.id || L.createId(),
        backup: item.backup,
        choices: choices,
        finger: JSON.stringify(item.backup.assignments || {})
      });
    });
    const lib = state.libraries.find(function (item) { return item.id === state.plan.libraryId; }) || state.libraries[0];
    if (lib) {
      state.libraryId = lib.id;
      state.mitBackup = lib.backup;
      state.mitChoices = lib.choices;
    }
    fillFightMenu();
    fillJobs();
    if (location.protocol !== "file:") {
      fetchJson(mitUrl("raids.json")).then(function (manifest) {
        state.mitNames = state.mitNames || {};
        (manifest.raids || []).forEach(function (raid) {
          state.mitNames[raid.id] = raid.shortName || raid.name || raid.id;
        });
        fillFightMenu();
      }).catch(function () {});
    }
    if ((state.plan.casts || []).some(function (cast) { return cast.skillName; }) && axisForJob(state.plan.jobId)) {
      const axis = axisForJob(state.plan.jobId);
      importAxis(axis.raidId, axis.role, axis.job, state.mode === "sheet");
    }
  }

  function fillFightMenu() {
    const menu = document.getElementById("fight-menu");
    if (!menu) return;
    clear(menu);
    if (!state.libraries.length) {
      menu.appendChild(el("p", "job-group", "先按匯入"));
      setFightLabel();
      return;
    }
    state.libraries.forEach(function (lib, index) {
      if (state.libraries.length > 1) menu.appendChild(el("p", "job-group", "備份 " + (index + 1)));
      (lib.choices.raids || []).forEach(function (raid) {
        const raidName = (state.mitNames && state.mitNames[raid.id]) || raid.id;
        jobRows(raid).forEach(function (row) {
          const known = Skills.byId(row.job);
          const jobName = known ? known.name : (row.job || "未標職業");
          menu.appendChild(button("job-choice", raidName + " " + row.role + " " + jobName, "pick-fight", {
            id: axisKey(lib.id, raid.id, row.role, row.job)
          }));
        });
      });
    });
    setFightLabel();
  }

  function defaultRow(lib) {
    const choices = lib.choices;
    const raid = (choices.raids || []).find(function (item) { return item.id === choices.defaultRaid; }) || choices.raids[0];
    if (!raid) return null;
    const rows = jobRows(raid);
    return rows.find(function (row) { return row.key === choices.defaultJobKey; }) || rows[0] || null;
  }

  function pickFight(key) {
    const parts = String(key || "").split("|");
    const lib = state.libraries.find(function (item) { return item.id === parts[0]; });
    if (!lib) return;
    state.libraryId = lib.id;
    state.mitBackup = lib.backup;
    state.mitChoices = lib.choices;
    importAxis(parts[1], parts[2], parts.slice(3).join("|"), state.mode === "sheet");
  }

  function restoreBackup() {
    try {
      const raw = JSON.parse(localStorage.getItem(BACKUP) || "null");
      if (!L.isMitBackup(raw)) return;
      const choices = L.mitBackupChoices(raw);
      if (!choices.raids.length) return;
      state.mitBackup = raw;
      state.mitChoices = choices;
      document.getElementById("show-mit").hidden = false;
      if (location.protocol === "file:") return;
      fetchJson(mitUrl("raids.json")).then(function (manifest) {
        state.mitNames = state.mitNames || {};
        (manifest.raids || []).forEach(function (raid) {
          state.mitNames[raid.id] = raid.shortName || raid.name || raid.id;
        });
      }).catch(function () { /* 沒連上就用副本代號對名稱 */ });
    } catch (error) { /* 沒有上次的備份 */ }
  }

  let axisToken = 0;

  function importAxis(raidId, role, onlyJob, keepSheet) {
    const backup = state.mitBackup;
    const token = ++axisToken;
    if (!backup || !raidId || !role) {
      setStatus("先選 boss 和職業。");
      return;
    }
    if (location.protocol === "file:") {
      setSheetMsg("請先雙擊 start.bat，用瀏覽器開 http://127.0.0.1:8766/ 再換職業。");
      setStatus("請先雙擊 start.bat，用瀏覽器開 http://127.0.0.1:8766/ 再匯入。直接開檔案讀不到機制名稱。", 12000);
      return;
    }
    const previousJob = state.plan.jobId;
    const go = document.querySelector('[data-act="mit-go"]');
    if (go) go.disabled = true;
    setStatus("正在讀時間軸…", 20000);
    setSheetMsg("正在換成" + ((Skills.byId(onlyJob) && Skills.byId(onlyJob).name) || onlyJob) + "…");
    loadMitBundle(raidId).then(function (bundle) {
      if (token !== axisToken || state.mitBackup !== backup) return;
      bundle.onlyJob = onlyJob;
      const known = Skills.byId(onlyJob);
      bundle.jobLabel = known ? known.name : onlyJob;
      state.plan = L.mitPlanFromBackup(backup, raidId, role, bundle);
      state.plan.libraryId = state.libraryId || "";
      const skipped = state.plan.skippedOtherJob || 0;
      const brought = state.plan.name + "，" + state.plan.casts.length + " 次施放。";
      const message = skipped
        ? "已帶入" + brought + "另外 " + skipped + " 次是這個位置上其他職業的技能，沒帶進來。"
        : "已帶入" + brought;
      state.armed = null;
      state.pendingDelete = null;
      state.nextKey = "";
      fillJobs();
      persist();
      fillStatic();
      setMode(keepSheet ? "sheet" : "plan");
      renderAll();
      setSheetMsg(message);
      setStatus(message, 12000);
    }).catch(function (error) {
      if (token !== axisToken) return;
      setSheetJob(previousJob);
      setPlanJob(previousJob);
      const message = error && error.message ? error.message : "";
      if (message.indexOf("時間軸") >= 0 || message.indexOf("沒有") >= 0 || message.indexOf("備份") >= 0 || message.indexOf("start.bat") >= 0) {
        setSheetMsg(message);
        setStatus(message, 12000);
      } else {
        setSheetMsg("讀不到時間軸。請確認 start.bat 還開著，並連上網。");
        setStatus("讀不到時間軸。請確認 start.bat 還開著，並連上網。機制名稱要向 mit.xivtc.com 要。", 12000);
      }
    }).then(function () {
      if (go) go.disabled = false;
    });
  }

  function importMit() {
    const raidId = document.getElementById("mit-raid").dataset.raid;
    const pick = document.getElementById("mit-job").dataset.pick || "";
    const parts = pick.split("|");
    const role = parts[0] || "";
    const onlyJob = parts.slice(1).join("|");
    importAxis(raidId, role, onlyJob, false);
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
      setSheetMsg("ACT 正在同步。要自己練，先按重來。");
      return;
    }
    state.preview = false;
    document.body.classList.remove("preview-overlay");
    state.clock = { zeroAt: Date.now(), paused: null, source: "practice" };
    state.lastFocusId = null;
    setMode("sheet");
    ensureTick();
  }

  function startPreview() {
    if (state.clock.source === "act" && state.clock.zeroAt != null) {
      setSheetMsg("ACT 正在同步。要預覽，先按重來。");
      return;
    }
    const casts = L.sortedByTime(state.plan.casts);
    if (!casts.length) {
      setSheetMsg("還沒有施放時間。先選上面的職業。");
      return;
    }
    const ahead = Math.max(Number(state.plan.leadSec) + 6, 8);
    const startAt = casts[0].time - ahead;
    state.preview = true;
    if (!state.overlay) document.body.classList.add("preview-overlay");
    state.clock = { zeroAt: Date.now() - startAt * 1000, paused: null, source: "practice" };
    state.lastFocusId = null;
    setMode("sheet");
    ensureTick();
  }

  function endPreview() {
    state.preview = false;
    document.body.classList.remove("preview-overlay");
    resetClock();
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
    state.preview = false;
    document.body.classList.remove("preview-overlay");
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

  function meterScale(focus, now) {
    const left = focus.time - now;
    if (left >= 5) return 1;
    return Math.max(0, left / 5);
  }

  function queueRows(casts, now) {
    const active = casts.filter(function (cast) {
      return now == null || cast.time + L.HOLD_SEC >= now;
    });
    let soonCount = 0;
    if (now != null) {
      for (let i = 0; i < active.length; i += 1) {
        if (active[i].time - now <= 5) soonCount += 1;
        else break;
      }
    }
    const total = soonCount > 0 ? soonCount + 2 : Math.min(2, active.length);
    return active.slice(0, total).map(function (cast, index) {
      return { cast: cast, big: index < soonCount };
    });
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
      actStatus.textContent = state.clock.source === "act" ? "ACT 同步中" : (state.preview ? "預覽中" : "練習計時");
    }
    updatePreviewButton();
    const focus = now == null ? (casts[0] || null) : L.focusCast(casts, now, lead);
    const phase = now == null ? (focus ? "idle" : "done") : L.phaseOf(focus, now, lead);
    const rows = queueRows(casts, now);
    const head = rows.length ? rows[0].cast : focus;
    const hero = document.getElementById("hero");
    const kicker = document.getElementById("hero-kicker");
    const warn = document.getElementById("hero-warn");
    const meter = document.getElementById("hero-meter");
    const fill = document.getElementById("hero-meter-fill");
    hero.className = "hero " + (phase === "idle" ? "wait" : phase);
    if (!head) {
      kicker.textContent = casts.length ? "這段結束" : "還沒排技能";
      warn.textContent = "";
      meter.hidden = true;
    } else {
      kicker.textContent = "";
      warn.textContent = issues[head.id] ? "這次排太早，冷卻還差 " + Math.ceil(issues[head.id].short) + " 秒" : "";
      meter.hidden = false;
      const scale = now == null ? 1 : meterScale(head, now);
      fill.style.transform = "scaleX(" + scale.toFixed(4) + ")";
    }
    paintQueue(rows, now);
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

  function iconUrl(file) {
    if (!file) return "";
    if (location.protocol === "file:") return "https://mit.xivtc.com/data/icons/" + file;
    return "/api/mit/icons/" + file;
  }

  function paintQueue(rows, now) {
    const key = rows.map(function (row) {
      const cast = row.cast;
      return cast.id + (row.big ? "!" : ".") + "@" + L.skillName(state.plan, cast) + "@" + (cast.note || "");
    }).join("|");
    if (key !== state.nextKey) {
      state.nextKey = key;
      const stack = document.getElementById("hero-stack");
      const list = document.getElementById("next-two");
      clear(stack);
      clear(list);
      const small = [];
      rows.forEach(function (row) {
        if (row.big) stack.appendChild(bigRow(row.cast));
        else small.push(row.cast);
      });
      small.forEach(function (cast) { list.appendChild(smallRow(cast)); });
      list.hidden = small.length === 0;
    }
    document.querySelectorAll("#hero-stack .soon-row").forEach(function (row) {
      const node = row.querySelector(".digit");
      if (!node || now == null) return;
      node.textContent = String(Math.max(0, Math.ceil(Number(row.dataset.time) - now)));
    });
    document.querySelectorAll("#next-two li").forEach(function (row) {
      const node = row.querySelector(".t");
      if (!node) return;
      const time = Number(row.dataset.time);
      node.textContent = now == null ? L.formatTime(time) : L.formatTime(Math.max(0, time - now));
    });
  }

  function skillIcon(name) {
    const icon = document.createElement("img");
    icon.alt = "";
    const file = Skills.iconFor(name);
    if (file) {
      icon.src = iconUrl(file);
      icon.addEventListener("error", function () { icon.remove(); });
    } else icon.hidden = true;
    return icon;
  }

  function bigRow(cast) {
    const name = L.skillName(state.plan, cast);
    const row = el("div", "soon-row");
    row.dataset.time = String(cast.time);
    const digit = el("span", "digit", "5");
    const copy = el("div", "copy");
    copy.appendChild(el("p", "n", name));
    if (cast.note) copy.appendChild(el("p", "m", cast.note));
    row.appendChild(digit);
    row.appendChild(skillIcon(name));
    row.appendChild(copy);
    return row;
  }

  function smallRow(cast) {
    const name = L.skillName(state.plan, cast);
    const item = el("li", "");
    item.dataset.time = String(cast.time);
    item.appendChild(skillIcon(name));
    item.appendChild(el("span", "t", L.formatTime(cast.time)));
    item.appendChild(el("span", "n", name));
    if (cast.note) item.appendChild(el("span", "m", cast.note));
    return item;
  }

  function updatePreviewButton() {
    const label = state.preview ? "結束預覽" : "預覽倒數";
    document.querySelectorAll('[data-act="preview"]').forEach(function (button) {
      button.textContent = label;
    });
  }

  function adoptActClock(zeroAt) {
    state.preview = false;
    document.body.classList.remove("preview-overlay");
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
