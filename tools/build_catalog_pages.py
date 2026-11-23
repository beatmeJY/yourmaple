"""몬스터·아이템마다 검색용 원본 페이지를 배포할 때 만든다(2026-11-16 사용자 요청).

사용: python3 tools/build_catalog_pages.py <출력 폴더>            (공개 도감을 읽어 만든다)
      python3 tools/build_catalog_pages.py <출력 폴더> --fixture x.json   (검사용 고정 자료)

- 주소는 /monsters/<몬스터 번호>/ · /items/<아이템 번호>/ (이름이 같은 것이 있어 번호를 쓴다, 번호가 없으면 id).
- 맵(2026-11-23 사용자 요청)은 /maps/<맵 번호>/: 이름·지역·그림·나오는 몬스터(최대 마릿수)·포탈로 이어진 맵.
  맵 표(sql/076)를 못 읽으면 맵 페이지만 건너뛰고 몬스터·아이템 페이지는 그대로 만든다.
- 페이지에는 검색 로봇이 읽을 제목·수치·드랍을 원본 HTML로 넣고, 앱(main.js)을 함께 띄운다.
  사람에게는 앱이 이 자리를 도감 화면으로 바꿔 그리고 주소의 번호로 그 몬스터·아이템을 고른다.
- 공개 도감(비로그인 읽기 권한)만 읽는다. 지운 몬스터와 그 드랍은 공개 읽기 정책(sql/071)이 이미 숨긴다.
- 결과 파일은 저장소에 넣지 않는다. 배포마다 새로 만들어 관리자 수정이 다음 배포에 반영된다.
- 공개 도감을 읽지 못하면 1로 끝내 배포를 멈춘다. GitHub Pages 는 직전 배포를 그대로 둔다.
- 도감 수집처 이름·주소는 쓰지 않는다(AGENTS.md 6절).
"""
import html, json, os, pathlib, re, sys, time, urllib.request
from collections import defaultdict

SITE = "https://yourmaple.kr"
ACTIONS = ["move", "fly", "stand", "die1"]
# 원본 그림이 비어 있는 보스는 우리 그림을 먼저 쓴다(js/catalog-image.js 의 bossArt 와 같게, 번호와 이름이 모두 맞을 때만).
BOSS_ART = {"8810018": ("혼테일", "/img/horntail.png"), "8810118": ("카오스 혼테일", "/img/horntail.png"),
            "8888888": ("자쿰", "/img/zakum.png"), "8888889": ("카오스 자쿰", "/img/zakum.png")}
KIND_NAMES = {"Etc": "기타", "Cash": "캐시", "Use": "소비", "Setup": "설치"}
FOOTER = ('<footer><a class="footer-brand" href="/">Your Maple</a><nav aria-label="정책"><a href="/privacy.html">개인정보 처리방침</a>'
          '<a href="/terms.html">이용약관</a><a href="mailto:yourmaplekr@gmail.com">문의</a></nav>'
          '<p>Your Maple(유얼메이플)은 Nexon·메이플스토리·메이플랜드의 공식 서비스가 아닌 이용자 도구입니다.</p></footer>')
e = html.escape


def config():
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
    if not url or not key:
        # 로컬에서는 js/config.js 의 공개 설정을 읽는다(값은 출력하지 않는다).
        text = pathlib.Path("js/config.js").read_text(encoding="utf-8")
        url = re.search(r'supabaseUrl:\s*"([^"]+)"', text).group(1).rstrip("/")
        key = re.search(r'supabasePublishableKey:\s*"([^"]+)"', text).group(1)
    if not url.startswith("https://") or key.startswith("sb_secret_"):
        raise SystemExit("공개 설정(Publishable key)만 쓸 수 있습니다.")
    return url, key


def fetch_all(url, key, table, columns, order):
    rows, size = [], 1000
    while True:
        request = urllib.request.Request(
            f"{url}/rest/v1/{table}?select={columns}&order={order}",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Range-Unit": "items", "Range": f"{len(rows)}-{len(rows) + size - 1}"},
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    page = json.loads(response.read().decode("utf-8"))
                break
            except Exception as error:  # 잠깐 끊김은 두 번까지 다시 시도
                if attempt == 2:
                    raise SystemExit(f"{table} 읽기 실패: {error}")
                time.sleep(2 * (attempt + 1))
        rows += page
        if len(page) < size:
            return rows


def load_live():
    url, key = config()
    monsters = fetch_all(url, key, "catalog_monsters",
                         "id,name,level,hp,exp,mp,required_accuracy,weak_elements,resist_elements,image_url,source_id,image_link_monster_id", "level.asc,name.asc,id.asc")
    drops = fetch_all(url, key, "catalog_monster_drops", "monster_id,item_id,rate_percent,source_entry", "monster_id.asc,source_entry.asc,id.asc")
    items = fetch_all(url, key, "catalog_items", "id,name,category,middle_category,subcategory,required_level,description,effect_description,base_options,image_url,source_id", "id.asc")
    return monsters, drops, items


def load_maps():
    """맵 정보(sql/076). 표가 없거나 못 읽으면 맵 페이지만 건너뛴다(몬스터·아이템 페이지는 계속 만든다)."""
    url, key = config()
    try:
        maps = fetch_all(url, key, "catalog_maps", "id,source_id,name,street_name,render,minimap,portals", "source_id.asc")
        links = fetch_all(url, key, "catalog_map_monsters", "map_id,monster_id,max_count", "map_id.asc,monster_id.asc")
    except SystemExit as error:
        print(f"맵 정보를 읽지 못해 맵 페이지는 건너뜁니다: {error}")
        return [], []
    return maps, links


EQUIP_CATEGORIES = {"장비", "방어구", "무기", "Equip"}
# js/item-options.js 의 옵션 이름과 같게.
STAT_LABELS = {"attack": "공격력", "magic_attack": "마력", "str": "STR", "dex": "DEX", "int": "INT", "luk": "LUK", "hp": "HP", "mp": "MP",
               "hp_percent": "HP 증가율 (%)", "mp_percent": "MP 증가율 (%)", "defense": "물리 방어", "magic_defense": "마법 방어",
               "accuracy": "명중", "avoidability": "회피", "speed": "이동속도", "jump": "점프력"}


def clean_text(value):
    """설명의 게임 글자색 기호(#c…#)를 지우고 빠진 줄바꿈을 넣는다(js/item-text.js 의 tidyItemText 와 같은 줄바꿈 규칙).
    주문서 효과 덩어리를 옵션으로 나누는 일은 sql/073 이 한다. 실행 전 자료면 효과 글이 설명에 남는다."""
    text = str(value or "")
    if "#c" in text:
        text = re.sub(r"([.!?])[ \t]*#c", lambda m: m.group(1) + "\n", text).replace("#c", "").replace("#", "")
    text = re.sub(r"(\S)(직업|조건) : ", r"\1\n\2 : ", text)
    text = re.sub(r"다\.([가-힣A-Za-z])", r"다.\n\1", text)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def lines_html(text):
    return "<br />".join(e(line) for line in text.split("\n"))


def fmt(value):
    if value is None or value == "":
        return "미제공"
    number = float(value)
    return f"{int(number):,}" if number.is_integer() else f"{number:,.2f}".rstrip("0").rstrip(".")


def rate_text(rate):
    if rate is None:
        return "확률 미상"
    text = f"{float(rate):.4f}".rstrip("0").rstrip(".")
    return f"{text}%"


def image_urls(url):
    """도감 화면과 같은 순서(move → fly → stand → die1)로 시도할 그림 주소들."""
    if not url or not str(url).startswith("https://"):
        return []
    match = re.match(r"^(https://maplestory\.io/api/[^/]+/[^/]+/mob/\d+/render/)[^/?#]+(.*)$", url)
    if not match:
        return [url]
    return [f"{match.group(1)}{action}{match.group(2) or '?bgColor='}" for action in ACTIONS]


def slug(monster):
    return str(monster.get("source_id") or monster["id"])


def elements(text):
    return [name for name in str(text or "").split(", ") if name]


def item_kind(item):
    if item.get("category") in KIND_NAMES:
        return KIND_NAMES[item["category"]]
    return item.get("subcategory") or item.get("middle_category") or item.get("category") or "아이템"


def by_rate(drops):
    return sorted(drops, key=lambda d: -(float(d["rate_percent"]) if d.get("rate_percent") is not None else -1))


def unique_by_slug(rows):
    """주소가 겹치거나 이상한 번호는 빼고 순서를 지킨다."""
    seen, unique = set(), []
    for row in rows:
        key = slug(row)
        if key not in seen and re.fullmatch(r"[0-9A-Za-z-]+", key):
            seen.add(key)
            unique.append(row)
    return unique


def shell(*, title, desc, keywords, url, crumb_label, crumb_href, name, body, kind):
    ld = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Your Maple", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": crumb_label, "item": SITE + crumb_href},
        {"@type": "ListItem", "position": 3, "name": name, "item": url}]}]
    # 이름에 </script> 같은 글자가 있어도 스크립트 칸을 벗어나지 않게 바꿔 둔다.
    ld_json = json.dumps(ld, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    path = url[len(SITE):]
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <base href="/" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}" />
  <meta name="keywords" content="{e(keywords)}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="ko_KR" />
  <meta property="og:site_name" content="Your Maple" />
  <meta property="og:title" content="{e(title)}" />
  <meta property="og:description" content="{e(desc)}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="{SITE}/apple-touch-icon.png" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="stylesheet" href="./css/public.css" data-feature-style />
  <link rel="stylesheet" href="./css/feature.css" data-feature-style />
  <link rel="stylesheet" href="./css/styles.css" data-app-style disabled />
  <link rel="stylesheet" href="./css/catalog-review.css" data-app-style disabled />
  <script type="application/ld+json">{ld_json}</script>
</head>
<body class="feature-page mon-page">
  <div id="app">
  <!-- {kind} 검색용 원본. tools/build_catalog_pages.py 가 배포할 때 공개 도감으로 만든다(저장소에 없음).
       앱(main.js)이 뜨면 이 자리를 도감 화면으로 바꿔 그리고, 주소의 번호로 이 {kind}을(를) 고른다. -->
  <a class="skip-link" href="{e(path)}#content">본문으로 건너뛰기</a>
  <header class="site-header"><a class="brand" href="/"><img src="/apple-touch-icon.png" width="36" height="36" alt="" />Your Maple</a></header>
  <main id="content" tabindex="-1">
    <nav class="mon-crumb" aria-label="위치"><a href="/">홈</a> › <a href="{crumb_href}">{e(crumb_label)}</a> › <span>{e(name)}</span></nav>
{body}
  </main>
  {FOOTER}
  </div>
  <script type="module" src="./js/main.js"></script>
</body>
</html>
"""


def monster_page(monster, drops, items, item_links, by_id, neighbors):
    name, level = monster["name"], monster.get("level")
    lv = f"Lv.{fmt(level)}" if level is not None else "레벨 미제공"
    rows = by_rate(drops)
    drop_names = [items[d["item_id"]]["name"] for d in rows if d.get("item_id") in items]
    top = ", ".join(dict.fromkeys(drop_names[:3]))
    desc = (f"메이플랜드(메랜) {name} {lv}: HP {fmt(monster.get('hp'))}, 경험치 {fmt(monster.get('exp'))}"
            + (f", 드랍 아이템 {len(rows)}개({top} 등)와 드랍 확률" if rows else "")
            + "을 확인하세요. Your Maple(유얼메이플) 몬스터 도감.")
    boss = BOSS_ART.get(str(monster.get("source_id")))
    urls = [boss[1]] if boss and boss[0] == name else image_urls(monster.get("image_url"))
    fallback = by_id.get(monster.get("image_link_monster_id"), {}).get("image_url")
    if fallback:  # 원본이 다 안 뜨면 관리자가 이어 둔 몬스터 그림(sql/070)
        urls += image_urls(fallback)
    art = (f'<img src="{e(urls[0])}" data-alts="{e(" ".join(urls[1:]))}" width="140" height="140" alt="{e(name)}" referrerpolicy="no-referrer" '
           'onerror="var a=(this.dataset.alts||\'\').split(\' \').filter(Boolean);if(a.length){this.dataset.alts=a.slice(1).join(\' \');this.src=a[0];}else{this.remove();}" />') if urls else ""
    weak, resist = elements(monster.get("weak_elements")), elements(monster.get("resist_elements"))
    stats = [("레벨", fmt(level)), ("HP", fmt(monster.get("hp"))), ("경험치", fmt(monster.get("exp"))), ("MP", fmt(monster.get("mp"))),
             ("필요 명중", fmt(monster.get("required_accuracy"))), ("약점", ", ".join(weak) or "없음"), ("반감", ", ".join(resist) or "없음")]
    stat_html = "".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in stats)
    if rows:
        drop_html = "<ol class=\"mon-drops\">" + "".join(
            f'<li><a href="{e(item_links.get(d.get("item_id"), "/items/"))}">{e(items[d["item_id"]]["name"]) if d.get("item_id") in items else "아이템 정보 없음"}</a><span>{e(rate_text(d.get("rate_percent")))}</span></li>'
            for d in rows) + "</ol>"
    else:
        drop_html = '<p class="hint">등록된 드랍 정보가 없어요.</p>'
    near = "".join(f'<a href="/monsters/{e(slug(m))}/">{e(m["name"])} <small>Lv.{e(fmt(m.get("level")))}</small></a>' for m in neighbors)
    body = f"""    <div class="feature-hero">
      <div class="hero"><p class="eyebrow">MAPLELAND · 메랜 몬스터 도감</p><h1>{e(name)} <span class="mon-lv">{e(lv)}</span></h1>
        <p class="lead">메이플랜드(메랜) {e(name)}의 HP·경험치·필요 명중{f"과 드랍 아이템 {len(rows)}개를 확률 높은 순으로" if rows else "을"} 정리했어요.</p>
        <div class="cta-row"><a class="ghost-cta" href="/monsters/">다른 몬스터 찾기</a></div></div>
      <div class="feature-art is-smooth">{art}</div>
    </div>
    <section aria-labelledby="t-stats"><p class="section-number">01</p><h2 id="t-stats">기본 정보</h2><dl class="mon-stats">{stat_html}</dl></section>
    <section aria-labelledby="t-drops"><p class="section-number">02</p><h2 id="t-drops">{e(name)} 드랍 아이템{f" {len(rows)}개" if rows else ""}</h2>{drop_html}
      <p class="hint">드랍 확률은 공개된 자료와 운영자 확인을 바탕으로 정리한 참고값이에요. 실제 게임과 다를 수 있어요.</p></section>
    {f'<section aria-labelledby="t-near"><p class="section-number">03</p><h2 id="t-near">비슷한 레벨 몬스터</h2><nav class="feature-nav mon-near">{near}</nav></section>' if near else ""}"""
    return shell(title=f"메랜 {name} — 드랍 아이템·확률·경험치·HP | 메이플랜드 몬스터 도감", desc=desc,
                 keywords=f"메랜 {name}, 메이플랜드 {name}, {name} 드랍, 메랜, 메이플랜드, 옛메, 메이플스토리, 유얼메이플",
                 url=f"{SITE}/monsters/{slug(monster)}/", crumb_label="메랜 몬스터 도감", crumb_href="/monsters/", name=name, body=body, kind="몬스터")


def item_page(item, drops, monsters, monster_links):
    name, kind = item["name"], item_kind(item)
    level = item.get("required_level")
    lv = f"Lv.{fmt(level)}" if level not in (None, "", 0) else ""
    rows = [d for d in by_rate(drops) if d.get("monster_id") in monsters]
    names = list(dict.fromkeys(monsters[d["monster_id"]]["name"] for d in rows))
    desc = (f"메이플랜드(메랜) {name}({kind}{' ' + lv if lv else ''})"
            + (f": 드랍 몬스터 {len(names)}종({', '.join(names[:3])} 등)과 드랍 확률" if rows else "의 정보")
            + "을 확인하세요. Your Maple(유얼메이플) 아이템 도감.")
    image = item.get("image_url") if str(item.get("image_url") or "").startswith("https://") else ""
    art = f'<img src="{e(image)}" width="96" height="96" alt="{e(name)}" referrerpolicy="no-referrer" onerror="this.remove()" />' if image else ""
    facts = [("종류", kind), ("착용 레벨", fmt(level) if level not in (None, "") else "미제공")]
    fact_html = "".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in facts)
    cleaned = clean_text(item.get("description"))
    description = f'<p>{lines_html(cleaned)}</p>' if cleaned else ""
    if item.get("category") not in EQUIP_CATEGORIES:
        effects = [line for line in clean_text(item.get("effect_description")).split("\n") if line]
        options = item.get("base_options") or {}
        order = list(STAT_LABELS)  # 장비 옵션 입력칸 순서(js/item-options.js)와 같게
        ordered = sorted(options.items(), key=lambda kv: order.index(kv[0]) if kv[0] in order else len(order))
        effects += [f"{STAT_LABELS.get(k, k)} {'+' if isinstance(v, (int, float)) and v > 0 else ''}{v}" for k, v in ordered]
        if effects:
            facts.append(("효과", " · ".join(effects)))
            fact_html = "".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in facts)
    if rows:
        drop_html = "<ol class=\"mon-drops\">" + "".join(
            f'<li><a href="{e(monster_links.get(d["monster_id"], "/monsters/"))}">{e(monsters[d["monster_id"]]["name"])} '
            f'<small>Lv.{e(fmt(monsters[d["monster_id"]].get("level")))}</small></a><span>{e(rate_text(d.get("rate_percent")))}</span></li>'
            for d in rows) + "</ol>"
    else:
        drop_html = '<p class="hint">등록된 드랍 몬스터가 없어요. 정보가 없을 뿐 드랍하지 않는다는 뜻은 아니에요.</p>'
    body = f"""    <div class="feature-hero">
      <div class="hero"><p class="eyebrow">MAPLELAND · 메랜 아이템 도감</p><h1>{e(name)} <span class="mon-lv">{e(kind)}</span></h1>
        <p class="lead">메이플랜드(메랜) {e(name)}{f"을(를) 드랍하는 몬스터 {len(names)}종과 확률을" if rows else "의 정보를"} 정리했어요.</p>
        {description}
        <div class="cta-row"><a class="ghost-cta" href="/items/">다른 아이템 찾기</a></div></div>
      <div class="feature-art is-smooth">{art}</div>
    </div>
    <section aria-labelledby="t-facts"><p class="section-number">01</p><h2 id="t-facts">기본 정보</h2><dl class="mon-stats">{fact_html}</dl></section>
    <section aria-labelledby="t-drops"><p class="section-number">02</p><h2 id="t-drops">{e(name)} 드랍 몬스터{f" {len(names)}종" if rows else ""}</h2>{drop_html}
      <p class="hint">드랍 확률은 공개된 자료와 운영자 확인을 바탕으로 정리한 참고값이에요. 실제 게임과 다를 수 있어요.</p></section>"""
    return shell(title=f"메랜 {name} — 드랍 몬스터·확률·옵션 | 메이플랜드 아이템 도감", desc=desc,
                 keywords=f"메랜 {name}, 메이플랜드 {name}, {name} 드랍, {name} 옵션, 메랜, 메이플랜드, 옛메, 메이플스토리, 유얼메이플",
                 url=f"{SITE}/items/{slug(item)}/", crumb_label="메랜 아이템 도감", crumb_href="/items/", name=name, body=body, kind="아이템")


MAP_VERSION = re.compile(r"^[a-z]{3}/\d{1,4}$")


def map_image(map_row):
    """맵 그림: 맵마다 정해진 버전의 전체 그림, 없으면 미니맵, 그것도 없으면 옛 버전 미니맵(화면 js/pages/maps.js 와 같은 순서)."""
    sid = map_row["source_id"]
    render, minimap = map_row.get("render") or {}, map_row.get("minimap") or {}
    if MAP_VERSION.match(str(render.get("v") or "")):
        return f"https://maplestory.io/api/{render['v']}/map/{sid}/render/900"
    version = minimap.get("v") if MAP_VERSION.match(str(minimap.get("v") or "")) else "gms/83"
    return f"https://maplestory.io/api/{version}/map/{sid}/minimap"


def map_page(map_row, monsters, map_names):
    name, street, sid = map_row["name"], map_row.get("street_name") or "", map_row["source_id"]
    rows = sorted(monsters, key=lambda r: (r[0].get("level") is None, r[0].get("level") or 0, r[0]["name"]))
    names = [m["name"] for m, _, _ in rows]
    levels = [m["level"] for m, _, _ in rows if m.get("level") is not None]
    lv = (f"Lv.{fmt(min(levels))}" + (f"~{fmt(max(levels))}" if max(levels) != min(levels) else "")) if levels else ""
    exits, seen = [], set()
    for portal in map_row.get("portals") or []:
        to = portal.get("to")
        if isinstance(to, int) and to in map_names and to not in seen:
            seen.add(to)
            exits.append(to)
    place = f"{street} " if street else ""
    desc = (f"메이플랜드(메랜) {place}{name}"
            + (f"에 나오는 몬스터 {len(rows)}종({', '.join(names[:3])}{' 등' if len(rows) > 3 else ''}{', ' + lv if lv else ''})" if rows else "의 맵 그림")
            + (f"과 포탈로 이어진 맵 {len(exits)}곳" if exits else "")
            + "을 확인하세요. Your Maple(유얼메이플) 맵 정보.")
    image = map_image(map_row)
    art = f'<img src="{e(image)}" alt="{e(name)} 맵" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()" />'
    facts = [("지역", street or "미제공"), ("맵 번호", str(sid)), ("몬스터", f"{len(rows)}종"), ("레벨", lv or "몬스터 없음"), ("이동 포탈", f"{len(exits)}곳")]
    fact_html = "".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in facts)
    if rows:
        mob_html = "<ol class=\"mon-drops\">" + "".join(
            f'<li><a href="{e(link)}">{e(m["name"])} <small>Lv.{e(fmt(m.get("level")))}</small></a><span>{e(f"최대 {count}마리" if count else "")}</span></li>'
            for m, link, count in rows) + "</ol>"
    else:
        mob_html = '<p class="hint">이 맵에 나오는 도감 몬스터가 없어요.</p>'
    exit_html = "".join(f'<a href="/maps/{to}/">{e(map_names[to][0])}{f" <small>{e(map_names[to][1])}</small>" if map_names[to][1] else ""}</a>' for to in exits)
    body = f"""    <div class="feature-hero">
      <div class="hero"><p class="eyebrow">MAPLELAND · 메랜 맵 정보</p><h1>{e(name)} <span class="mon-lv">{e(street or "맵")}</span></h1>
        <p class="lead">메이플랜드(메랜) {e(place)}{e(name)}{f"에 나오는 몬스터 {len(rows)}종과" if rows else "의"} 포탈로 이어진 맵을 정리했어요.</p>
        <div class="cta-row"><a class="ghost-cta" href="/maps/">다른 맵 찾기</a></div></div>
      <div class="feature-art is-smooth">{art}</div>
    </div>
    <section aria-labelledby="t-facts"><p class="section-number">01</p><h2 id="t-facts">기본 정보</h2><dl class="mon-stats">{fact_html}</dl></section>
    <section aria-labelledby="t-mobs"><p class="section-number">02</p><h2 id="t-mobs">{e(name)}에 나오는 몬스터{f" {len(rows)}종" if rows else ""}</h2>{mob_html}
      <p class="hint">맵·몬스터 정보는 공개된 게임 자료를 바탕으로 정리한 참고값이에요. 실제 게임과 다를 수 있어요.</p></section>
    {f'<section aria-labelledby="t-exits"><p class="section-number">03</p><h2 id="t-exits">포탈로 이어진 맵</h2><nav class="feature-nav mon-near">{exit_html}</nav></section>' if exits else ""}"""
    return shell(title=f"메랜 {name} — 나오는 몬스터·포탈 | 메이플랜드 맵 정보", desc=desc,
                 keywords=f"메랜 {name}, 메이플랜드 {name}, {name} 몬스터, {street + ', ' if street else ''}메랜 맵, 메랜, 메이플랜드, 옛메, 메이플스토리, 유얼메이플",
                 url=f"{SITE}/maps/{sid}/", crumb_label="메랜 맵 정보", crumb_href="/maps/", name=name, body=body, kind="맵")


def write(out, folder, key, text):
    path = out / folder / key / "index.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def build(out, monsters, drops, items_list, maps=(), map_links=()):
    items = {item["id"]: item for item in items_list}
    by_id = {m["id"]: m for m in monsters}
    drops_of_monster, drops_of_item = defaultdict(list), defaultdict(list)
    for drop in drops:
        drops_of_monster[drop["monster_id"]].append(drop)
        drops_of_item[drop.get("item_id")].append(drop)
    ordered = unique_by_slug(sorted(monsters, key=lambda m: (m.get("level") is None, m.get("level") or 0, m["name"], m["id"])))
    item_rows = unique_by_slug(sorted(items_list, key=lambda i: (str(i.get("source_id") or ""), i["id"])))
    # 링크는 실제로 만든 페이지로만 건다(번호가 겹쳐 빠진 것은 목록으로).
    monster_links = {m["id"]: f"/monsters/{slug(m)}/" for m in ordered}
    item_links = {i["id"]: f"/items/{slug(i)}/" for i in item_rows}
    total_bytes, monster_keys, item_keys = 0, [], []
    for index, monster in enumerate(ordered):
        neighbors = [m for m in ordered[max(0, index - 4):index + 5] if m is not monster][:8]
        total_bytes += write(out, "monsters", slug(monster), monster_page(monster, drops_of_monster.get(monster["id"], []), items, item_links, by_id, neighbors))
        monster_keys.append((slug(monster), monster))
    monsters_by_id = {m["id"]: m for m in ordered}
    for item in item_rows:
        total_bytes += write(out, "items", slug(item), item_page(item, drops_of_item.get(item["id"], []), monsters_by_id, monster_links))
        item_keys.append(slug(item))
    # 맵(sql/076): 맵 번호 주소. 몬스터는 실제로 만든 몬스터 페이지로만 잇는다(지운 몬스터는 공개 읽기에 없음).
    map_keys = []
    valid_maps = [m for m in maps if isinstance(m.get("source_id"), int) and m["source_id"] > 0]
    map_names = {m["source_id"]: (m["name"], m.get("street_name") or "") for m in valid_maps}
    mobs_of_map = defaultdict(list)
    for link in map_links:
        monster = monsters_by_id.get(link.get("monster_id"))
        if monster and link.get("monster_id") in monster_links:
            mobs_of_map[link["map_id"]].append((monster, monster_links[link["monster_id"]], link.get("max_count")))
    for map_row in valid_maps:
        total_bytes += write(out, "maps", str(map_row["source_id"]), map_page(map_row, mobs_of_map.get(map_row["id"], []), map_names))
        map_keys.append(str(map_row["source_id"]))
    # 사이트맵: 예전 몬스터·아이템·맵 주소를 지우고 이번 주소만 더한다.
    sitemap = out / "sitemap.xml"
    if sitemap.exists():
        xml = sitemap.read_text(encoding="utf-8")
        xml = re.sub(r"\s*<url><loc>https://yourmaple\.kr/(?:monsters|items|maps)/[^<]+/</loc></url>", "", xml)
        extra = "".join(f"\n  <url><loc>{SITE}/monsters/{key}/</loc></url>" for key, _ in monster_keys)
        extra += "".join(f"\n  <url><loc>{SITE}/items/{key}/</loc></url>" for key in item_keys)
        extra += "".join(f"\n  <url><loc>{SITE}/maps/{key}/</loc></url>" for key in map_keys)
        sitemap.write_text(xml.replace("\n</urlset>", extra + "\n</urlset>"), encoding="utf-8")
    # 몬스터 도감 소개 페이지에 전체 몬스터 링크 목록을 넣는다(검색 로봇이 따라갈 수 있게). 아이템은 몬스터 페이지의 드랍 링크와 사이트맵으로 이어진다.
    intro = out / "monsters" / "index.html"
    if intro.exists():
        links = "".join(f'<a href="/monsters/{e(key)}/">{e(m["name"])} <small>Lv.{e(fmt(m.get("level")))}</small></a>' for key, m in monster_keys)
        block = (f'<section aria-labelledby="t-all"><p class="section-number">05</p><h2 id="t-all">메랜 몬스터 전체 목록 ({len(monster_keys)}마리)</h2>'
                 f'<nav class="feature-nav mon-all" aria-label="몬스터 전체 목록">{links}</nav></section>')
        text = intro.read_text(encoding="utf-8")
        if "<!-- monster-list -->" in text:
            intro.write_text(text.replace("<!-- monster-list -->", block), encoding="utf-8")
    return len(monster_keys), len(item_keys), len(map_keys), total_bytes


def maps_admin_only(routes_js=None):
    """맵 메뉴가 관리자 전용(js/routes.js 의 maps 에 admin: true)이면 공개 검색용 페이지를 만들지 않는다(2026-11-23 사용자 요청)."""
    text = (routes_js or (pathlib.Path(__file__).resolve().parent.parent / "js" / "routes.js")).read_text(encoding="utf-8")
    route = re.search(r'\{[^{}]*id: "maps"[^{}]*\}', text)
    return bool(route and re.search(r"\badmin: true\b", route.group(0)))


def main():
    out = pathlib.Path(sys.argv[1])
    started = time.time()
    if "--fixture" in sys.argv:
        data = json.loads(pathlib.Path(sys.argv[sys.argv.index("--fixture") + 1]).read_text(encoding="utf-8"))
        monsters, drops, items = data["monsters"], data["drops"], data["items"]
        maps, map_links = data.get("maps", []), data.get("map_monsters", [])
    else:
        monsters, drops, items = load_live()
        maps, map_links = [], []
    # 관리자 전용인 동안은 맵 페이지·사이트맵 주소를 만들지 않는다(검사는 --include-admin 으로 강제할 수 있다).
    if maps_admin_only() and "--include-admin" not in sys.argv:
        print("맵 정보가 관리자 전용이라 맵 페이지는 만들지 않습니다.")
        maps, map_links = [], []
    elif "--fixture" not in sys.argv:
        maps, map_links = load_maps()
    fetched = time.time()
    if not monsters or not items:
        raise SystemExit("공개 도감에 몬스터나 아이템이 없습니다. 배포를 멈춥니다.")
    monster_count, item_count, map_count, total_bytes = build(out, monsters, drops, items, maps, map_links)
    # 블로그용 측정값: 읽은 양·만든 페이지 수·용량·걸린 시간
    print(f"몬스터 페이지 {monster_count}개 · 아이템 페이지 {item_count}개 · 맵 페이지 {map_count}개 · 드랍 {len(drops)} · "
          f"{total_bytes / 1024 / 1024:.2f}MB · 읽기 {fetched - started:.1f}초 · 만들기 {time.time() - fetched:.1f}초")


if __name__ == "__main__":
    main()
