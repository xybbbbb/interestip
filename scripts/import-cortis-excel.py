#!/usr/bin/env python3
"""
把用户手工整理的 CORTIS SPOTS Excel 转成项目统一 JSON。

用法：
  python scripts/import-cortis-excel.py --input "C:\\...\\CORTIS SPOTS data collecting.xlsx"

输出：
  data/cortis-spots-raw.json（原始候选 + 证据链 + 待核验标记）
"""

import argparse
import json
import re
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

CATEGORY_MAP = {
    "同款店铺": ("shop", "same_type_shop"),
    "同款地点": ("photo_spot", "same_type_spot"),
    "专缉拍摄地": ("filming_location", "filming_location"),
    "专辑拍摄地": ("filming_location", "filming_location"),
    "MV拍摄地": ("filming_location", "filming_location"),
    "公司": ("company", "company"),
    "广告投放点": ("ad_spot", "ad_spot"),
}

CONF_MAP = {"高": "high", "中": "medium", "低": "low"}


def clean(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def extract_url(text):
    match = re.search(r"https?://[^\s\"']+", text or "")
    if not match:
        return ""
    return match.group(0).rstrip(".,;)]")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--sheet", default="Sheet1")
    parser.add_argument("--out", default=str(ROOT / "data" / "cortis-spots-raw.json"))
    args = parser.parse_args()

    df = pd.read_excel(args.input, sheet_name=args.sheet)
    df.columns = [str(c).strip() for c in df.columns]

    places = []
    for index, row in df.iterrows():
        name = clean(row.get("地点名称（中/英/韩）"))
        if not name:
            continue
        area = clean(row.get("所在区域"))
        address = clean(row.get("地址或地图线索"))
        category_raw = clean(row.get("地点类别"))
        platform = clean(row.get("来源平台")) or "小红书"
        confidence = CONF_MAP.get(clean(row.get("置信度")), "medium")
        note = clean(row.get("备注"))
        url = extract_url(clean(row.get("来源链接")))
        place_type, category = CATEGORY_MAP.get(category_raw, ("photo_spot", "same_type_spot"))

        needs = []
        if not area:
            needs.append("缺少所在区域")
        if not address:
            needs.append("缺少地址线索")
        if re.search(r"你查|帮我查|具体地址|待查|不确定", address + note):
            needs.append("地址待查询/确认")
        if not url:
            needs.append("缺少来源链接")
        if not re.search(r"[가-힣]", name + " " + address):
            needs.append("缺少韩文名/韩文地址")

        places.append(
            {
                "id": f"cortis-{index + 1:03d}",
                "source": "user-excel",
                "name": name,
                "nameLocal": "",
                "type": place_type,
                "category": category,
                "interestRelated": True,
                "district": area,
                "address": address,
                "latitude": None,
                "longitude": None,
                "openingHours": "",
                "description": note,
                "imageUrl": None,
                "tags": ["CORTIS", category_raw or "同款", platform],
                "evidence": [
                    {
                        "id": f"ev-cortis-{index + 1:03d}-a",
                        "claim": note or f"{name} 与 CORTIS 相关（用户整理）",
                        "source": platform,
                        "sourceType": "community",
                        "url": url,
                        "publishedAt": "",
                        "summary": note,
                        "confidence": confidence,
                    }
                ],
                "confidence": confidence,
                "needsVerification": bool(needs),
                "verificationNotes": needs,
            }
        )

    payload = {
        "source": "user-excel",
        "sourceFile": Path(args.input).name,
        "importedAt": date.today().isoformat(),
        "note": "用户手工整理的 CORTIS 同款地点原始候选；坐标、区名、韩文名尚未核验。",
        "places": places,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入 {out}（{len(places)} 条）")


if __name__ == "__main__":
    main()
