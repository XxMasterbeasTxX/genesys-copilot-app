/**
 * Welcome / landing page — shown when no route is selected.
 */
export function renderWelcomePage() {
  const root = document.createElement("section");
  root.className = "card";
  root.innerHTML = `
    <h1 class="h1">Welcome</h1>
    <p class="p">Select a page from the menu.</p>
  `;
  return root;
}
