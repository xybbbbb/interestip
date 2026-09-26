#!/usr/bin/env node
/**
 * 把 data/cortis-spots.json 里的真实 CORTIS 地点写入 web-preview/index.html 的 PLACES 数组。
 * 保留：示例演唱会场地（P0 占位）+ 现有 P2 官方观光点。
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data", "cortis-spots.json");
const HTML_FILE = path.join(ROOT, "web-preview", "index.html");
const FIRST_SIGHT_MARKER = '  {id:"vs-CNP000067"';

const js = (value) => JSON.stringify(value === undefined ? null : value);

function entry(place) {
  const evidence = place.evidence?.[0] || {};
  const hours =
    place.openingHours || (place.type === "ad_spot" ? "快闪活动已结束" : "时间以来源帖子为准");
  const note =
    place.id === "cortis-007"
      ? "快闪活动已于 2026-08-25 结束，安排前需确认是否再举办"
      : place.id === "cortis-010"
        ? "位于金浦市，首尔市外，需单独安排往返"
        : "";
  const ev = {
    srcType: evidence.sourceType || "community",
    src: evidence.source || "小红书",
    claim: evidence.claim || place.description || `${place.name} 与 CORTIS 相关`,
    date: evidence.publishedAt || "",
    url: evidence.url || "",
    summary: evidence.summary || place.description || "",
    conf: evidence.confidence || place.confidence || "medium",
  };
  return `  {id:${js(place.id)},name:${js(place.name)},nameLocal:${js(place.nameLocal || "")},type:${js(place.type)},pool:"fan",district:${js(place.district || "首尔")},lat:${place.latitude},lng:${place.longitude},hours:${js(hours)},conf:${js(place.confidence || "medium")},why:${js(place.description || "")},note:${js(note)},evidence:[{srcType:${js(ev.srcType)},src:${js(ev.src)},claim:${js(ev.claim)},date:${js(ev.date)},url:${js(ev.url)},summary:${js(ev.summary)},conf:${js(ev.conf)}}]}`;
}

const demoVenue = `  {id:"demo-concert-001",name:"示例·演唱会场地（待替换为真实场馆）",nameLocal:"서울 올림픽공원（예시）",type:"venue",pool:"fan",district:"松坡区",lat:37.5206,lng:127.1211,hours:"演出日 19:00",conf:"high",why:"P0 演唱会为已锁定行程；场馆信息待用户提供后替换为真实演出地址。",note:"",evidence:[{srcType:"official",src:"演唱会官方公告（占位）",claim:"用户已确认会在此场地观看 CORTIS 演唱会（场馆待补充）",date:"",url:"https://example.com/",summary:"演示占位；等待真实演出场馆",conf:"high"}]}`;

const payload = JSON.parse(readFileSync(DATA_FILE, "utf8"));
const html = readFileSync(HTML_FILE, "utf8");
const start = html.indexOf("const PLACES = [");
const markerIndex = html.indexOf(FIRST_SIGHT_MARKER, start);
if (start < 0 || markerIndex < 0) {
  console.error("未找到 PLACES 数组或 P2 起点标记，已中止");
  process.exit(1);
}

const entries = [demoVenue, ...payload.places.map(entry)];
const block = `const PLACES = [\n${entries.map((line) => `${line},`).join("\n")}\n`;
const nextHtml = html.slice(0, start) + block + html.slice(markerIndex);
writeFileSync(HTML_FILE, nextHtml, "utf8");
console.log(`已写入 ${entries.length} 条 P0/P1 地点到 ${HTML_FILE}`);
