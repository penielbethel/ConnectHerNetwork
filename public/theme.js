document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem("theme");

  if (savedTheme === "light") {
    root.classList.add("light-theme");
  } else {
    root.classList.remove("light-theme");
  }

  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      root.classList.toggle("light-theme");
      const newTheme = root.classList.contains("light-theme") ? "light" : "dark";
      localStorage.setItem("theme", newTheme);
    });
  }
});
