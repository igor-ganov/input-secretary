import { html, LitElement } from "lit";

export const AppStatus = class extends LitElement {
  public override render() {
    return html`<p role="status">Ready</p>`;
  }
};

customElements.define("app-status", AppStatus);
