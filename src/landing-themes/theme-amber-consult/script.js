document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".amber-menu-toggle");
  const menu = document.querySelector(".amber-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", () => menu.classList.toggle("is-open"));
  }
});