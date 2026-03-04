export async function renderNotFoundPage({ route }) {
  const root = document.createElement("div");

  const card = document.createElement("section");
  card.className = "card";

  const h1 = document.createElement("h1");
  h1.className = "h1";
  h1.textContent = "Not found";

  const p = document.createElement("p");
  p.className = "p";
  p.textContent = `No page registered for route: ${route}`;

  card.append(h1, p);
  root.append(card);

  return root;
}
