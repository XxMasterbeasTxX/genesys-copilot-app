/**
 * Generic placeholder page for routes that exist in the nav tree
 * but don't have a dedicated implementation yet.
 */
export async function render({ route }) {
  const root = document.createElement("div");

  const card = document.createElement("section");
  card.className = "card";

  const h1 = document.createElement("h1");
  h1.className = "h1";
  h1.textContent = "Coming soon";

  const p = document.createElement("p");
  p.className = "p";
  p.textContent = "This page is under development.";

  const routeLabel = document.createElement("p");
  routeLabel.className = "p";
  routeLabel.style.marginTop = "8px";
  routeLabel.style.fontFamily = "monospace";
  routeLabel.style.fontSize = "12px";
  routeLabel.textContent = route;

  card.append(h1, p, routeLabel);
  root.append(card);
  return root;
}
