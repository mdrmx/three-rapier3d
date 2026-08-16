export function uiPanel() {
  const panel = document.createElement("div");
  panel.style.position = "absolute";
  panel.style.top = "10px";
  panel.style.left = "10px";
  panel.style.padding = "10px";
  panel.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  panel.style.color = "white";
  panel.style.fontFamily = "Arial, sans-serif";
  panel.style.fontSize = "14px";
  panel.style.borderRadius = "5px";
  panel.style.zIndex = "1000";

  const title = document.createElement("h3");
  title.textContent = "Controls";
  title.style.marginTop = "0";
  title.style.marginBottom = "10px";
  panel.appendChild(title);

  const instructions = document.createElement("p");
  instructions.innerHTML = `
        <strong>WASD</strong>: Move<br>
        <strong>Mouse</strong>: Look around<br>
        <strong>Space</strong>: Jump<br>
        <strong>Shift</strong>: Sprint<br>
        <strong>R</strong>: Reset position<br>
        <strong>Esc</strong>: Release pointer lock
    `;
  panel.appendChild(instructions);

  document.body.appendChild(panel);
}
