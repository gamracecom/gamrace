const REGION_API = "https://gamrace-wallet-api.gamracecom.workers.dev";

function countryName(code) {
  try { return new Intl.DisplayNames([navigator.language || "en"], { type: "region" }).of(code) || code; } catch { return code; }
}

function showRegionBlock(access) {
  const overlay = document.createElement("main");
  overlay.className = "region-block-screen";
  overlay.setAttribute("role", "alert");
  const place = access.countryCode && access.countryCode !== "XX" ? countryName(access.countryCode) : "your region";
  overlay.innerHTML = `<section class="region-block-card">
    <img src="assets/brand/gamrace-icon.png" alt="" />
    <p>REGION UNAVAILABLE</p>
    <h1>GamRace is not available in ${place}</h1>
    <span>Access from this location is currently restricted. If you are using a VPN or proxy, try disabling it and refresh the page.</span>
    <button type="button">Try again</button>
    <small>Location is estimated from your internet connection and may not be exact.</small>
  </section>`;
  overlay.querySelector("button").addEventListener("click", () => location.reload());
  document.body.append(overlay);
  document.body.classList.add("region-blocked");
}

fetch(`${REGION_API}/region-access`, { cache: "no-store" })
  .then((response) => response.ok ? response.json() : null)
  .then((access) => { if (access && access.allowed === false) showRegionBlock(access); })
  .catch(() => { /* Fail open so a provider outage cannot lock out the public site. */ });
