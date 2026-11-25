(function (global) {
  function normalizeProductSearch(value) {
    return String(value ?? "")
      .normalize("NFD")
      .toLocaleLowerCase("es-AR")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  global.normalizeProductSearch = normalizeProductSearch;
  if (typeof module !== "undefined" && module.exports) module.exports = normalizeProductSearch;
})(globalThis);
