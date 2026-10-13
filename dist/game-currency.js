(() => {
  "use strict";

  function render(fields, detail) {
    const displayFiat = detail?.displayFiat !== false;
    const symbol = String(detail?.asset?.symbol || "COIN").toUpperCase();
    const icon = String(detail?.asset?.icon || "usdt").toLowerCase().replace(/[^a-z0-9-]/g, "");

    Array.from(fields || []).forEach((field) => {
      field.replaceChildren();
      field.classList.toggle("crypto-icon-mark", !displayFiat);
      field.title = displayFiat ? "Fiat amount" : symbol;
      if (displayFiat) {
        field.textContent = "$";
        return;
      }

      const image = document.createElement("img");
      image.src = `assets/icons/crypto/${icon || "usdt"}.svg`;
      image.alt = symbol;
      field.append(image);
    });
  }

  window.GamRaceBetCurrency = Object.freeze({ render });
})();
