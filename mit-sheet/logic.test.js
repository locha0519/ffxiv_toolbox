const assert = require("assert");
const L = require("./logic.js");

function planWith(extra) {
  return L.normalizePlan(Object.assign({
    name: "測試",
    leadSec: 2,
    skills: [{ id: "a", name: "雪仇", cooldown: 60, duration: 15, charges: 1 }],
    mechanics: [],
    casts: []
  }, extra));
}

assert.strictEqual(L.parseTime("1:05"), 65);
assert.strictEqual(L.parseTime("01:05"), 65);
assert.strictEqual(L.parseTime("90"), 90);
assert.strictEqual(L.parseTime("12.5"), 12.5);
assert.strictEqual(L.parseTime("00:12.5"), 12.5);
assert.strictEqual(L.parseTime("-0:05"), -5);
assert.strictEqual(L.parseTime("1:60"), null);
assert.strictEqual(L.parseTime("abc"), null);
assert.strictEqual(L.parseTime(""), null);
assert.strictEqual(L.formatTime(65), "01:05");
assert.strictEqual(L.formatTime(-5), "-00:05");
assert.strictEqual(L.formatTime(12.6), "00:13");
assert.strictEqual(L.formatEdit(12.5), "00:12.5");
assert.strictEqual(L.formatEdit(65), "01:05");

const cd = planWith({
  casts: [
    { id: "c1", time: 0, skillId: "a" },
    { id: "c2", time: 30, skillId: "a" }
  ]
});
const issues = L.conflicts(cd);
assert.ok(issues.c2);
assert.strictEqual(Math.round(issues.c2.short), 30);
assert.ok(!issues.c1);

const charges = L.normalizePlan({
  skills: [{ id: "a", name: "獻奉", cooldown: 60, duration: 10, charges: 2 }],
  casts: [
    { id: "c1", time: 0, skillId: "a" },
    { id: "c2", time: 10, skillId: "a" },
    { id: "c3", time: 30, skillId: "a" },
    { id: "c4", time: 70, skillId: "a" }
  ]
});
const chargeIssues = L.conflicts(charges);
assert.ok(!chargeIssues.c1);
assert.ok(!chargeIssues.c2);
assert.ok(chargeIssues.c3);
assert.ok(!chargeIssues.c4);

const casts = [{ id: "a", time: 10 }, { id: "b", time: 32 }];
assert.strictEqual(L.focusCast(casts, 0, 2).id, "a");
assert.strictEqual(L.focusCast(casts, 8, 2).id, "a");
assert.strictEqual(L.focusCast(casts, 10, 2).id, "a");
assert.strictEqual(L.focusCast(casts, 12, 2).id, "b");
assert.strictEqual(L.focusCast(casts, 31, 2).id, "b");
assert.strictEqual(L.focusCast(casts, 40, 2), null);
assert.strictEqual(L.phaseOf(casts[0], 0, 2), "wait");
assert.strictEqual(L.phaseOf(casts[0], 8.5, 2), "ready");
assert.strictEqual(L.phaseOf(casts[0], 10.2, 2), "now");

const pasted = L.parseMechanics("0:12 全體傷害\n# 跳過\n65 分散\nbad\n1:60 不行\n");
assert.deepStrictEqual(pasted, [
  { time: 12, name: "全體傷害" },
  { time: 65, name: "分散" }
]);

const macroPlan = planWith({
  casts: [
    { id: "c1", time: 10, skillId: "a", note: "全體" },
    { id: "c2", time: 32, skillId: "a", note: "雙重" }
  ]
});
const macro = L.macroText(macroPlan);
assert.ok(macro.includes("請在開打瞬間按下"));
assert.ok(macro.includes("/e ⋯<wait.8>"));
assert.ok(macro.includes("/e 00:10 雪仇 全體 <se.6><wait.22>"));
assert.ok(macro.includes("/e 00:32 雪仇 雙重 <se.6>"));

const many = [];
for (let i = 0; i < 16; i += 1) {
  many.push({ id: "c" + i, time: i * 5, skillId: "a", note: "" });
}
const split = L.macroText(planWith({ leadSec: 0, casts: many }));
assert.ok(split.includes("# 1（請在開打瞬間按下）"));
assert.ok(split.includes("# 2（請在戰鬥經過 01:15 時按下）"));

const prepull = L.macroText(planWith({
  leadSec: 2,
  casts: [{ id: "c1", time: 0, skillId: "a", note: "" }]
}));
assert.ok(prepull.includes("請在開打前 2 秒按下"));
assert.ok(prepull.includes("/e 00:00 雪仇 <se.6>"));

const xml = L.triggerXml(macroPlan);
assert.ok(xml.includes('PrevActions="Interrupt"'));
assert.ok(xml.includes("(?&lt;cd&gt;\\d+)"));
assert.ok(xml.includes('ExecutionDelayExpression="(${cd}+8)*1000"'));
assert.ok(xml.includes('UseTTSTextExpression="開雪仇"'));
assert.ok(xml.includes("ExportedFolder"));

const cactbot = L.cactbotText(macroPlan);
assert.ok(cactbot.includes('-10.0 "--sync--"'));
assert.ok(cactbot.includes('8.0 "開雪仇"'));
assert.ok(cactbot.includes('30.0 "開雪仇"'));

const sheet = L.cheatSheetText(macroPlan);
assert.ok(sheet.includes("依時間"));
assert.ok(sheet.includes("00:10  雪仇  全體"));
assert.ok(sheet.includes("依技能"));
assert.ok(sheet.includes("雪仇"));

assert.strictEqual(L.parseCountdown("[12:00:00.000] 00:0038::Battle commencing in 10 seconds!"), 10);
assert.strictEqual(L.parseCountdown("00:0038::距開戰5秒"), 5);
assert.strictEqual(L.parseCountdown("00:0038::戰鬥將在15秒後開始"), 15);
assert.strictEqual(L.parseCountdown("你說 10 秒"), null);
assert.strictEqual(L.parseEngage("00:0039::Twintania engages!"), true);
assert.strictEqual(L.parseEngage("00:0038::Battle commencing in 10 seconds!"), false);
assert.strictEqual(L.parseEngage("Battle commencing!"), true);

const roundTrip = L.importJson(L.exportJson(macroPlan));
assert.strictEqual(roundTrip.casts.length, 2);
assert.strictEqual(roundTrip.skills[0].name, "雪仇");
assert.throws(function () { L.importJson("{"); }, /排軸檔/);
assert.throws(function () { L.importJson('{"nope":true}'); }, /排軸檔/);

const jobPlan = planWith({
  skills: [
    { id: "a", name: "雪仇", cooldown: 60, duration: 15 },
    { id: "b", name: "舊技能", cooldown: 10, duration: 1 }
  ],
  casts: [
    { id: "c1", time: 10, skillId: "a", note: "留" },
    { id: "c2", time: 20, skillId: "b", note: "舊" }
  ]
});
L.applyJob(jobPlan, {
  id: "PLD",
  skills: [{ name: "雪仇", cooldown: 60, duration: 15, charges: 1 }]
});
assert.strictEqual(jobPlan.skills.length, 1);
assert.strictEqual(jobPlan.skills[0].name, "雪仇");
assert.strictEqual(jobPlan.casts[0].skillId, jobPlan.skills[0].id);
assert.strictEqual(jobPlan.casts[1].skillName, "舊技能");

assert.strictEqual(L.parseCountdown("00|2026-01-01T00:00:00.0000000+08:00|0038||Battle commencing in 9 seconds!"), 9);

const mitBackup = {
  __v: 2,
  party: [{ role: "H1", job: "WHM" }],
  parties: { m6s: [{ role: "H1", job: "WHM" }, { role: "D1", job: "MNK" }] },
  assignments: {
    m6s: { p1: { "WHM_00#2": [1, 4], "AST_00#2": [1], "MNK_00#4": [1] } },
    m5s: { p1: { "WHM_00#2": [0] } }
  },
  castOffsets: { m6s: { p1: { "WHM_00#2@1": 3, "WHM_00#2@9": 99 } } },
  settings: { raid: "m6s", myRole: "H1", macroLeadSec: 2, phaseGaps: {} }
};
assert.strictEqual(L.isMitBackup(mitBackup), true);
assert.strictEqual(L.isMitBackup(macroPlan), false);
const choices = L.mitBackupChoices(mitBackup);
assert.strictEqual(choices.defaultRaid, "m6s");
assert.strictEqual(choices.defaultRole, "H1");
assert.strictEqual(choices.defaultJob, "WHM");
assert.strictEqual(choices.defaultJobKey, "H1|WHM");
const m6 = choices.raids.find((raid) => raid.id === "m6s");
assert.strictEqual(m6.roles.find((role) => role.role === "H1").casts, 3);
assert.strictEqual(m6.jobs.find((item) => item.job === "WHM" && item.role === "H1").casts, 2);
assert.strictEqual(m6.jobs.find((item) => item.job === "AST" && item.role === "H1").casts, 1);

const mitPlan = L.mitPlanFromBackup(mitBackup, "m6s", "H1", {
  raid: { id: "m6s", shortName: "M6S", phases: [{ id: "p1", label: "P1" }], defaultPhaseGaps: {} },
  jobLabel: "白魔法師",
  skills: [
    { id: "WHM_00", nameTC: "節制", recastSec: 120, durationSec: 20, charges: 1, job: "WHM" },
    { id: "AST_00", nameTC: "命運之輪", recastSec: 60, durationSec: 18, charges: 1, job: "AST" }
  ],
  phases: {
    p1: { actions: [
      { idx: 1, timeSec: 32, actionTC: "雙重攻擊" },
      { idx: 4, timeSec: 70, actionTC: "分散" }
    ] }
  }
});
assert.strictEqual(mitPlan.name, "M6S H1 白魔法師");
assert.strictEqual(mitPlan.jobId, "WHM");
assert.strictEqual(mitPlan.raidId, "m6s");
assert.strictEqual(mitPlan.role, "H1");
assert.strictEqual(mitPlan.leadSec, 2);
assert.strictEqual(mitPlan.casts.length, 2);
assert.strictEqual(mitPlan.casts[0].time, 35);
assert.strictEqual(mitPlan.casts[0].note, "雙重攻擊");
assert.strictEqual(mitPlan.casts[1].time, 70);
assert.strictEqual(mitPlan.skills.length, 1);
assert.strictEqual(mitPlan.skills[0].name, "節制");
assert.ok(!mitPlan.casts.some((cast) => cast.skillId === "MNK_00"));
assert.ok(!mitPlan.casts.some((cast) => cast.skillId === "AST_00"));
assert.strictEqual(mitPlan.skippedOtherJob, 1);

const astPlan = L.mitPlanFromBackup(mitBackup, "m6s", "H1", {
  raid: { id: "m6s", shortName: "M6S", phases: [{ id: "p1", label: "P1" }], defaultPhaseGaps: {} },
  jobLabel: "占星術士",
  onlyJob: "AST",
  skills: [
    { id: "WHM_00", nameTC: "節制", recastSec: 120, durationSec: 20, charges: 1, job: "WHM" },
    { id: "AST_00", nameTC: "命運之輪", recastSec: 60, durationSec: 18, charges: 1, job: "AST" }
  ],
  phases: {
    p1: { actions: [
      { idx: 1, timeSec: 32, actionTC: "雙重攻擊" },
      { idx: 4, timeSec: 70, actionTC: "分散" }
    ] }
  }
});
assert.strictEqual(astPlan.jobId, "AST");
assert.strictEqual(astPlan.casts.length, 1);
assert.strictEqual(astPlan.skills[0].name, "命運之輪");
assert.strictEqual(astPlan.skippedOtherJob, 2);

const phased = L.mitPlanFromBackup({
  assignments: { fru: { p1: { "PLD_00#0": [0] }, p2: { "PLD_00#0": [0] } } },
  settings: { raid: "fru", myRole: "MT", macroLeadSec: 1, phaseGaps: { fru: { p2: 10 } } },
  parties: { fru: [{ role: "MT", job: "PLD" }] }
}, "fru", "MT", {
  raid: {
    id: "fru", shortName: "絕伊甸",
    phases: [{ id: "p1", label: "P1" }, { id: "p2", label: "P2" }],
    defaultPhaseGaps: { p2: 99 }
  },
  skills: [{ id: "PLD_00", nameTC: "雪仇", recastSec: 60, durationSec: 15, charges: 1 }],
  phases: {
    p1: { actions: [{ idx: 0, timeSec: 100, actionTC: "前段" }] },
    p2: { actions: [{ idx: 0, timeSec: 5, actionTC: "後段" }] }
  }
});
assert.strictEqual(phased.casts[0].time, 100);
assert.strictEqual(phased.casts[1].time, 115);
assert.ok(phased.casts[1].note.indexOf("後段") >= 0);
assert.ok(phased.casts[1].note.indexOf("P2") >= 0);

console.log("logic.test.js ok");
