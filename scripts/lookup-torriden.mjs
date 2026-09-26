#!/usr/bin/env node
// 临时查询工具：在公开搜索结果里找 Torriden 圣水大楼地址线索。

const QUERIES = [
  "토리든 성수 팝업",
  "토리든 성수 광고",
  "성수동 토리든 건물",
  "토리든 옥외광고 성수",
  "site:blog.naver.com 토리든 성수",
  "성수동 토리든 팝업스토어 주소",
  "Torriden Seongsu popup",
];

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function bing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });
  return res.ok ? res.text() : "";
}

async function naver(query) {
  const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    });
    return res.ok ? res.text() : "";
  } catch {
    return "";
  }
}

function contexts(text, token, max = 6) {
  const results = [];
  let i = -1;
  while (results.length < max) {
    i = text.indexOf(token, i + 1);
    if (i < 0) break;
    results.push(text.slice(Math.max(0, i - 220), i + 280));
  }
  return results;
}

for (const query of QUERIES) {
  const html = await bing(query);
  const text = stripTags(html);
  console.log(`\n### BING ${query} (html=${html.length})`);
  for (const token of ["성동구", "성수동", "서울 성동", "토리든"]) {
    for (const context of contexts(text, token, 4)) {
      if (context.length < 60) continue;
      console.log(`[${token}] ${context.slice(0, 360)}`);
    }
  }
  const naverHtml = await naver(query);
  const naverText = stripTags(naverHtml);
  console.log(`### NAVER ${query} (html=${naverHtml.length})`);
  for (const token of ["성동구", "성수동", "서울 성동", "토리든"]) {
    for (const context of contexts(naverText, token, 3)) {
      if (context.length < 60) continue;
      console.log(`[N:${token}] ${context.slice(0, 360)}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
}
