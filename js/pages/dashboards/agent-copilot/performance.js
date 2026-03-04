/**
 * Dashboards › Agent Copilot › Performance
 */
export async function render({ route, me, api }) {
  const root = document.createElement("div");

  const card = document.createElement("section");
  card.className = "card";

  const h1 = document.createElement("h1");
  h1.className = "h1";
  h1.textContent = "Agent Copilot Performance";

  const p = document.createElement("p");
  p.className = "p";
  p.textContent = "Agent Copilot performance metrics will appear here.";

  card.append(h1, p);
  root.append(card);
  return root;
}
