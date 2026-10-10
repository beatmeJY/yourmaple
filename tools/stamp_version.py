"""배포 폴더(_site)의 파일 주소에 버전을 붙인다.

브라우저가 예전 JS/CSS를 캐시하면 새 main.js와 옛 router.js가 섞여 화면이 안 뜰 수 있다.
배포마다 바뀌는 버전(커밋 번호)을 index.html의 CSS·JS 주소와 JS 안의 상대 import 경로에 붙여
새로 배포하면 브라우저가 반드시 새 파일을 받게 한다. 사용자가 보는 주소창(#/화면)은 바뀌지 않는다.
저장소 원본은 고치지 않고 GitHub Actions가 배포 폴더에서만 실행한다.

사용: python3 tools/stamp_version.py <배포 폴더> <버전>
"""

import pathlib
import re
import sys

# from "./x.js", from "../x.js", import("./pages/x.js"), import "./x.js" 의 상대 경로만 바꾼다.
# supabase.from("links") 같은 DB 호출이나 https:// 주소는 ./ ../ 로 시작하지 않으므로 건드리지 않는다.
IMPORT = re.compile(r"""((?:\bfrom|\bimport)\s*\(?\s*["'])(\.{1,2}/[^"'?#]+\.js)(["'])""")
HTML_ASSET = re.compile(r"""((?:src|href)=["'])(\./(?:js|css)/[^"'?#]+\.(?:js|css))(["'])""")


def stamp(site: pathlib.Path, version: str) -> tuple[int, int]:
    index = site / "index.html"
    html = index.read_text(encoding="utf-8")
    html, html_count = HTML_ASSET.subn(rf"\1\2?v={version}\3", html)
    index.write_text(html, encoding="utf-8")

    import_count = 0
    for path in sorted((site / "js").rglob("*.js")):
        text = path.read_text(encoding="utf-8")
        text, count = IMPORT.subn(rf"\1\2?v={version}\3", text)
        if count:
            path.write_text(text, encoding="utf-8")
            import_count += count
    return html_count, import_count


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("사용: python3 tools/stamp_version.py <배포 폴더> <버전>")
    site = pathlib.Path(sys.argv[1])
    version = re.sub(r"[^0-9A-Za-z]", "", sys.argv[2])[:12]
    if not version:
        raise SystemExit("버전이 비어 있습니다.")
    html_count, import_count = stamp(site, version)
    # main.js와 styles.css 두 곳, 그리고 JS 안의 import가 하나도 안 바뀌면 규칙이 어긋난 것이므로 배포를 멈춘다.
    if html_count < 2 or import_count == 0:
        raise SystemExit(f"버전 붙이기 실패: index.html {html_count}곳, import {import_count}곳")
    print(f"버전 {version}: index.html {html_count}곳, import {import_count}곳")


if __name__ == "__main__":
    main()
