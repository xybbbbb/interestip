#!/usr/bin/env node
/**
 * 应用用户对 CORTIS 地点的人工确认结果。
 * 输入/输出：data/cortis-spots.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data", "cortis-spots.json");

const CONFIRMATIONS = {
  "cortis-001": {
    name: "二村汉江公园",
    nameLocal: "이촌한강공원",
    type: "photo_spot",
    category: "park",
    address: "이촌한강공원 (Ichon Hangang Park)",
    latitude: 37.518507,
    longitude: 126.9673584,
    description: "用户确认：以二村汉江公园本身作为打卡点，不再使用 CU 便利店。",
    tags: ["CORTIS", "汉江公园", "同款地点", "小红书"],
    confirmedByUser: true,
    needsVerification: false,
    verificationNotes: [],
  },
  "cortis-005": {
    name: "新沙站（5号出口）",
    nameLocal: "신사역",
    type: "filming_location",
    category: "filming_location",
    address: "신사역 5번 출구 (Sinsa Station Exit 5)",
    latitude: 37.516154,
    longitude: 127.0196291,
    description: "用户确认：以新沙站为打卡点（5 号出口）。",
    confirmedByUser: true,
    needsVerification: false,
    verificationNotes: [],
  },
  "cortis-007": {
    name: "Torriden 圣水快闪（Factory Seongsu）",
    nameLocal: "토리든 딥다이브 뉴스 팝업",
    type: "ad_spot",
    category: "popup_event",
    address: "서울 성동구 연무장7길 13, 팩토리얼 성수 1층 트렌드팟（올리브영 N 성수旁）",
    latitude: 37.544207,
    longitude: 127.0543773,
    openingHours: "快闪活动期间 2026-08-14 ~ 2026-08-25，11:00-20:00（已结束）",
    description: "CORTIS 成员 Martin 到访的 Torriden DEEP DIVE NEWS 快闪店；活动已结束，后续是否再举办需确认。",
    tags: ["CORTIS", "Torriden", "圣水", "快闪", "已结束"],
    confirmedByUser: false,
    needsVerification: true,
    verificationNotes: ["快闪活动已于 2026-08-25 结束，若安排进行程需确认后续是否还会举办"],
  },
  "cortis-008": {
    name: "直火匠人 龙山店",
    nameLocal: "직화장인 용산점",
    type: "shop",
    category: "same_type_shop",
    address: "서울 용산구 한강대로 58-1",
    latitude: 37.5258537,
    longitude: 126.9650592,
    description: "用户提供的地址：龙山区 汉江大路 58-1；OSM 无该店精确 POI，坐标为地址级。",
    confirmedByUser: true,
    needsVerification: true,
    verificationNotes: ["坐标为汉江大路 58-1 地址级，店铺门牌/入口以地图实景为准"],
  },
  "cortis-009": {
    name: "汉南站（1号出口）",
    nameLocal: "한남역",
    type: "filming_location",
    category: "filming_location",
    address: "한남역 1번 출구 (Hannam Station Exit 1)",
    latitude: 37.5294298,
    longitude: 127.0092073,
    description: "用户确认：以汉南站为“凌晨外出”拍摄地打卡点。",
    confirmedByUser: true,
    needsVerification: false,
    verificationNotes: [],
  },
  "cortis-010": {
    name: "乙支路煤炭烧烤 Gochon店",
    nameLocal: "을지로 석탄구이 고촌점",
    type: "shop",
    category: "same_type_shop",
    address: "김포시 고촌읍 고촌역 2번 출구一带",
    latitude: 37.6016091,
    longitude: 126.7702594,
    description: "用户确认：就是金浦高村店，不在首尔市区；行程需要单独安排往返。",
    confirmedByUser: true,
    needsVerification: true,
    verificationNotes: ["位于金浦市（首尔市外），安排行程时需要额外交通时间"],
  },
};

const DISTRICTS = {
  "cortis-001": "龙山区",
  "cortis-002": "西大门区",
  "cortis-003": "广津区",
  "cortis-004": "江南区",
  "cortis-005": "江南区",
  "cortis-006": "龙山区",
  "cortis-007": "城东区",
  "cortis-008": "龙山区",
  "cortis-009": "龙山区",
  "cortis-010": "金浦市",
};

const payload = JSON.parse(readFileSync(FILE, "utf8"));
payload.places = payload.places.map((place) =>
  CONFIRMATIONS[place.id]
    ? { ...place, ...CONFIRMATIONS[place.id], district: DISTRICTS[place.id] || place.district }
    : { ...place, district: DISTRICTS[place.id] || place.district }
);
payload.confirmedAt = new Date().toISOString().slice(0, 10);
payload.note = "用户手工整理的 CORTIS 同款地点（已人工确认 6 条；Torriden 快闪已结束需注意）。";
writeFileSync(FILE, JSON.stringify(payload, null, 2), "utf8");
console.log(`已更新 ${payload.places.length} 条地点：${FILE}`);
