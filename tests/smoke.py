"""Prueba de humo: `npm run build && npx vite preview --port 4173` y después `python3 tests/smoke.py`."""
from playwright.sync_api import sync_playwright
URL = "http://localhost:4173/"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(URL); pg.wait_for_timeout(800)
    pg.fill("input", "Luciano"); pg.click("button[type=submit]")
    pg.wait_for_timeout(7000)
    full = pg.inner_text(".stat >> nth=0") if pg.locator(".stat").count() else None
    lufs = lambda: pg.evaluate("document.querySelector('.lcd .l1 span:last-child b').textContent")
    print("bar:", pg.evaluate("document.querySelector('.lcd b').textContent"), "| LUFS todo:", lufs())
    # silenciar kick y bajo
    for nm in ["Kick", "Bajo", "Clap", "Hat"]:
        pg.click(f".tname:has-text('{nm}')")
    pg.click("nav button:has-text('Mixer')")
    for i in [0, 1, 2, 5]:
        pg.locator(".strip .ms .m").nth(i).click()
    pg.wait_for_timeout(9000)
    print("LUFS sin kick/bajo/clap/hat:", lufs())
    pg.click("nav button:has-text('Master')"); pg.wait_for_timeout(600)
    print("stats:", pg.inner_text(".stats").replace("\n", " "))
    pg.screenshot(path="/tmp/loop_master.png")
    pg.click("nav button:has-text('Patrón')"); pg.wait_for_timeout(500)
    pg.screenshot(path="/tmp/loop_pat.png", full_page=True)
    assert not errs, errs
    print("OK")
    b.close()
