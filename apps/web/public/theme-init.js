// Applies the saved or system theme before first paint so every page, including
// public ones, renders in the right theme. External file: the CSP forbids inline scripts.
(function () {
  var dark;
  try {
    var saved = localStorage.getItem("folio-theme");
    dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) {
    dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  document.documentElement.classList.toggle("dark", dark);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0d1420" : "#f5f6f8");
})();
