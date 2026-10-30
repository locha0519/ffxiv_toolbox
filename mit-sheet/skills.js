/* 繁中技能名、冷卻、持續時間。
 * 只收會拿來排軸的減傷、護盾和團隊冷卻，不含一般治療 GCD。
 * 名稱與秒數對齊台服 7.x：雪仇、鐵壁、牽制、昏亂、行吟、策動、防守之桑巴等。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MitSkills = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function s(name, cooldown, duration, charges) {
    return { name: name, cooldown: cooldown, duration: duration, charges: charges || 1 };
  }

  const tank = [s("雪仇", 60, 15), s("鐵壁", 90, 20)];
  const jobs = [
    { id: "PLD", name: "騎士", group: "坦克", skills: tank.concat([
      s("武裝戍衛", 120, 18), s("聖光幕簾", 90, 30), s("干預", 10, 8),
      s("壁壘", 90, 10), s("極致防禦", 120, 15), s("聖盾陣", 5, 8), s("神聖領域", 420, 10)
    ]) },
    { id: "WAR", name: "戰士", group: "坦克", skills: tank.concat([
      s("擺脫", 90, 30), s("原初的勇猛", 25, 8), s("戰慄", 90, 10),
      s("戮罪", 120, 15), s("原初的血氣", 25, 8), s("死鬥", 240, 10)
    ]) },
    { id: "DRK", name: "暗黑騎士", group: "坦克", skills: tank.concat([
      s("暗黑佈道", 90, 15), s("至黑之夜", 15, 7), s("獻奉", 60, 10, 2),
      s("棄明投暗", 60, 10), s("暗影衛", 120, 15), s("行屍走肉", 300, 10)
    ]) },
    { id: "GNB", name: "絕槍戰士", group: "坦克", skills: tank.concat([
      s("光之心", 90, 15), s("剛玉之心", 25, 8), s("極光", 60, 18, 2),
      s("偽裝", 90, 20), s("大星雲", 120, 15), s("超火流星", 360, 10)
    ]) },
    { id: "WHM", name: "白魔法師", group: "治療", skills: [
      s("節制", 120, 20), s("神愛撫", 1, 10), s("全大赦", 60, 10), s("庇護所", 90, 24),
      s("禮儀之鈴", 180, 20), s("水流幕", 60, 8), s("神祝禱", 30, 15, 2)
    ] },
    { id: "SCH", name: "學者", group: "治療", skills: [
      s("異想的幻光", 120, 20), s("野戰治療陣", 30, 15), s("疾風怒濤之計", 120, 20),
      s("展開戰術", 90, 30), s("熾天召喚", 120, 22), s("慰藉", 30, 15, 2),
      s("熾天附體", 180, 20), s("生命回生法", 60, 10)
    ] },
    { id: "AST", name: "占星術士", group: "治療", skills: [
      s("命運之輪", 60, 18), s("太陽星座", 1, 15), s("大宇宙", 180, 15),
      s("擢升", 60, 8), s("天星交錯", 30, 30, 2)
    ] },
    { id: "SGE", name: "賢者", group: "治療", skills: [
      s("整體論", 120, 20), s("堅角清汁", 30, 15), s("泛輸血", 120, 15),
      s("魂靈風息", 120, 15), s("智慧之愛", 180, 20), s("白牛清汁", 45, 15), s("輸血", 120, 15)
    ] },
    { id: "MNK", name: "武僧", group: "近戰", skills: [s("牽制", 90, 15), s("真言", 90, 15)] },
    { id: "DRG", name: "龍騎士", group: "近戰", skills: [s("牽制", 90, 15)] },
    { id: "NIN", name: "忍者", group: "近戰", skills: [s("牽制", 90, 15)] },
    { id: "SAM", name: "武士", group: "近戰", skills: [s("牽制", 90, 15)] },
    { id: "RPR", name: "鐮刀戰士", group: "近戰", skills: [s("牽制", 90, 15)] },
    { id: "VPR", name: "蝰蛇劍士", group: "近戰", skills: [s("牽制", 90, 15)] },
    { id: "BRD", name: "詩人", group: "遠程物理", skills: [s("行吟", 90, 15)] },
    { id: "MCH", name: "機工士", group: "遠程物理", skills: [s("策動", 90, 15), s("武裝解除", 120, 10)] },
    { id: "DNC", name: "舞者", group: "遠程物理", skills: [s("防守之桑巴", 90, 15), s("即興表演結束", 120, 15)] },
    { id: "BLM", name: "黑魔法師", group: "遠程魔法", skills: [s("昏亂", 90, 15)] },
    { id: "SMN", name: "召喚師", group: "遠程魔法", skills: [s("昏亂", 90, 15)] },
    { id: "RDM", name: "赤魔法師", group: "遠程魔法", skills: [s("昏亂", 90, 15), s("抗死", 120, 10)] },
    { id: "PCT", name: "繪影法師", group: "遠程魔法", skills: [s("昏亂", 90, 15), s("坦培拉塗層", 120, 10), s("油性坦培拉塗層", 1, 10)] }
  ];

  const byId = {};
  jobs.forEach(function (job) { byId[job.id] = job; });

  return {
    jobs: jobs,
    byId: function (id) { return byId[id] || null; }
  };
});
