#!/usr/bin/env node
/**
 * 用 Photon（Komoot，基于 OpenStreetMap）给 CORTIS 同款地点做第一遍地理编码。
 *
 * 输入：data/cortis-spots-raw.json
 * 输出：data/cortis-spots.json
 *
 * 注意：OSM 结果只作为候选坐标，全部标记 verified:false，必须人工核验。
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN_FILE = path.join(ROOT, "data", "cortis-spots-raw.json");
const OUT_FILE = path.join(ROOT, "data", "cortis-spots.json");
const USER_AGENT = "Interestip/0.1 (student prototype; place geocoding)";

const QUERIES = {
  "cortis-001": ["CU 한강르네상스 이촌2호점", "이촌한강공원", "Ichon Hangang Park"],
  "cortis-002": ["오크베리 신촌점", "Oakberry Sinchon Seoul", "신촌역 서울"],
  "cortis-003": ["어린이대공원 서울", "Children's Grand Park Seoul"],
  "cortis-004": ["봉은사 서울", "Bongeunsa Seoul"],
  "cortis-005": ["신사역 5번출구", "신사역 서울", "Sinsa Station Seoul"],
  "cortis-006": ["하이브 용산구", "HYBE Yongsan Seoul", "용산역 서울"],
  "cortis-007": ["토리든 성수", "Torriden Seongsu", "성수동 서울"],
  "cortis-008": ["직화장인 용산", "Jikhwajangin Yongsan", "용산역 서울"],
  "cortis-009": ["한남역 1번출구", "한남역 서울", "한남동 서울"],
  "cortis-010": ["고촌역", "을지로 석탄구이", "을지로3가 서울"],
};

// 自动地理编码匹配到错误分店/错误地点时的安全兜底：
// 只落到公园/站点/街区级别，并明确标注需要人工核验。
const OVERRIDES = {
  "cortis-001": {
    latitude: 37.518507,
    longitude: 126.9673584,
    geocode: {
      provider: "Photon (Komoot, OpenStreetMap-based)",
      query: "이촌한강공원",
      fallbackUsed: false,
      displayName: "이촌한강공원, 이촌1동, 서울특별시",
      resultType: "park",
      confidence: "medium",
      verified: false,
      note: "公园级坐标；CU 汉江文艺复兴二村2号店的具体门店位置待人工核验。",
    },
  },
  "cortis-005": {
    latitude: 37.516154,
    longitude: 127.0196291,
    geocode: {
      provider: "Photon (Komoot, OpenStreetMap-based)",
      query: "신사역",
      fallbackUsed: false,
      displayName: "신사역, 잠원동, 서울특별시",
      resultType: "station",
      confidence: "medium",
      verified: false,
      note: "新沙站坐标；用户线索为 5 号出口拍摄点，具体机位待人工核验。",
    },
  },
  "cortis-007": {
    latitude: 37.54048,
    longitude: 127.05601,
    geocode: {
      provider: "Photon (Komoot, OpenStreetMap-based)",
      query: "성수동2가",
      fallbackUsed: true,
      displayName: "성수동2가, 성수2가1동, 서울특별시",
      resultType: "quarter",
      confidence: "low",
      verified: false,
      note: "圣水洞区域级坐标；Torriden 大楼的具体位置待人工核验。",
    },
  },
  "cortis-008": {
    latitude: 37.5290767,
    longitude: 126.9658972,
    geocode: {
      provider: "Photon (Komoot, OpenStreetMap-based)",
      query: "용산역 서울",
      fallbackUsed: true,
      displayName: "용산역, 한강로동, 서울특별시",
      resultType: "station",
      confidence: "low",
      verified: false,
      note: "龙山站附近兜底坐标；直火匠人龙山店的具体门牌待人工核验。",
    },
  },
  "cortis-009": {
    latitude: 37.5294298,
    longitude: 127.0092073,
    geocode: {
      provider: "Photon (Komoot, OpenStreetMap-based)",
      query: "한남역 서울",
      fallbackUsed: true,
      displayName: "한남역, 용산구, 서울특별시",
      resultType: "station",
      confidence: "low",
      verified: false,
      note: "汉南站（1 号出口）兜底坐标；具体拍摄点待人工核验。",
    },
  },
  "cortis-010": {
    latitude: 37.6016091,
    longitude: 126.7702594,
    geocode: {
      provider: "Photon (Komoot, OpenStreetMap-based)",
      query: "고촌역",
      fallbackUsed: false,
      displayName: "고촌역, 고촌읍, 김포시",
      resultType: "station",
      confidence: "low",
      verified: false,
      note: "高村站位于金浦市，可能不在首尔行程范围；具体餐厅位置待人工核验。",
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function geocode(query) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const features = Array.isArray(json?.features) ? json.features : [];
  const korea = features.find((f) => (f.properties?.countrycode || "").toUpperCase() === "KR");
  return korea || features[0] || null;
}

function confidenceFor(result, queryIndex, specificType) {
  if (!result) return null;
  if (queryIndex > 0) return "low";
  if (specificType && result.properties?.osm_value && specificType.includes(result.properties.osm_value)) return "medium";
  return "medium";
}

async function main() {
  const payload = JSON.parse(readFileSync(IN_FILE, "utf8"));
  const places = [];
  for (const place of payload.places) {
    const queries = QUERIES[place.id] || [place.name];
    let found = null;
    let usedQuery = "";
    let usedIndex = -1;
    for (let i = 0; i < queries.length; i += 1) {
      try {
        await sleep(500);
        const result = await geocode(queries[i]);
        if (result) {
          found = result;
          usedQuery = queries[i];
          usedIndex = i;
          break;
        }
      } catch (err) {
        console.error(`[geocode] ${place.id} 查询失败：${queries[i]} → ${err.message}`);
      }
    }
    if (!found) {
      console.error(`[geocode] ${place.id} 未找到坐标：${place.name}`);
      places.push(place);
      continue;
    }
    const specificType = ["restaurant", "cafe", "convenience", "fast_food", "place_of_worship"];
    places.push({
      ...place,
      latitude: found.geometry?.coordinates?.[1] ?? null,
      longitude: found.geometry?.coordinates?.[0] ?? null,
      geocode: {
        provider: "Photon (Komoot, OpenStreetMap-based)",
        query: usedQuery,
        fallbackUsed: usedIndex > 0,
        displayName: [
          found.properties?.name,
          found.properties?.street,
          found.properties?.district,
          found.properties?.city,
          found.properties?.country,
        ]
          .filter(Boolean)
          .join(", "),
        osmType: found.properties?.osm_type || "",
        osmId: found.properties?.osm_id || null,
        resultType: found.properties?.osm_value || "",
        confidence: confidenceFor(found, usedIndex, specificType),
        verified: false,
        note: "Photon（OSM）自动地理编码结果，仅作候选坐标；需要人工在地图上核验。",
      },
    });
    console.error(
      `[geocode] ${place.id} → ${found.properties?.name || "?"} | ${found.properties?.city || ""} | ${found.geometry?.coordinates?.[1]}, ${found.geometry?.coordinates?.[0]}${usedIndex > 0 ? " [fallback]" : ""}`
    );
  }
  const finalPlaces = places.map((place) => {
    const override = OVERRIDES[place.id];
    if (!override) return place;
    return {
      ...place,
      ...override,
      needsVerification: true,
      verificationNotes: [...new Set([...(place.verificationNotes || []), "坐标为区域/站点级候选，需人工核验"])],
    };
  });
  const output = {
    ...payload,
    note: "用户手工整理的 CORTIS 同款地点（已做 OSM 地理编码，坐标待人工核验）。",
    geocodedAt: new Date().toISOString().slice(0, 10),
    places: finalPlaces,
  };
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");
  console.error(`[geocode] 已写入 ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("[geocode] 执行失败：", err);
  process.exit(1);
});
