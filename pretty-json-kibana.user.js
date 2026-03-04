// ==UserScript==
// @name         Pretty JSON in Kibana Discover
// @version      0.2
// @description  Pretty-print JSON in Kibana Discover cell expansion popovers
// @include      https://kibana.*.*/app/discover*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  /**
   * Tokenize text into plain text and JSON segments.
   * Non-JSON braces (e.g. Serilog {MappedVipLevel}) fail JSON.parse and stay as text.
   */
  function tokenize(text) {
    const tokens = [];
    let pos = 0;

    while (pos < text.length) {
      const startChar = text[pos];
      if (startChar !== "{" && startChar !== "[") {
        let end = pos + 1;
        while (end < text.length && text[end] !== "{" && text[end] !== "[")
          end++;
        tokens.push({ type: "text", value: text.slice(pos, end) });
        pos = end;
        continue;
      }

      const openChar = startChar;
      const closeChar = openChar === "{" ? "}" : "]";
      let depth = 0;
      let inString = false;
      let escape = false;
      let i = pos;

      while (i < text.length) {
        const ch = text[i];
        if (escape) {
          escape = false;
        } else if (ch === "\\" && inString) {
          escape = true;
        } else if (ch === '"') {
          inString = !inString;
        } else if (!inString) {
          if (ch === openChar) depth++;
          else if (ch === closeChar) {
            depth--;
            if (depth === 0) break;
          }
        }
        i++;
      }

      if (depth !== 0) {
        tokens.push({ type: "text", value: text[pos] });
        pos++;
        continue;
      }

      const candidate = text.slice(pos, i + 1);
      let parsed;
      try {
        parsed = JSON.parse(candidate);
      } catch (_) {
        tokens.push({ type: "text", value: candidate });
        pos = i + 1;
        continue;
      }

      tokens.push({ type: "json", value: candidate, parsed });
      pos = i + 1;
    }

    return tokens;
  }

  /**
   * Apply syntax highlighting to a pretty-printed JSON string.
   * Escapes HTML entities first, then wraps tokens in colored spans.
   */
  function syntaxHighlight(json) {
    const escaped = json
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return escaped.replace(
      /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let color;
        if (/^"/.test(match)) {
          color = /:$/.test(match) ? "#9cdcfe" : "#ce9178"; // key : string
        } else if (/true|false/.test(match)) {
          color = "#569cd6"; // boolean
        } else if (match === "null") {
          color = "#569cd6"; // null
        } else {
          color = "#b5cea8"; // number
        }
        return `<span style="color:${color}">${match}</span>`;
      },
    );
  }

  /**
   * Process the expansion popover: find the value span, tokenize, replace with
   * pretty-printed HTML. Leaves the table cells untouched.
   */
  function processPopover(popover) {
    if (popover.dataset.prettyJson) return;
    popover.dataset.prettyJson = "1";

    const span = popover.querySelector("span[class*='cellPopover']");
    if (!span) return;

    const text = span.textContent;
    if (!text) return;

    const tokens = tokenize(text);
    if (!tokens.some((t) => t.type === "json")) return;

    // Build fragment so we can attach real event listeners (no inline onclick)
    const fragment = document.createDocumentFragment();

    for (const token of tokens) {
      if (token.type === "text") {
        fragment.appendChild(document.createTextNode(token.value));
      } else {
        const pretty = JSON.stringify(token.parsed, null, 2);

        // Wrapper keeps the pre + button together
        const wrapper = document.createElement("div");
        wrapper.style.cssText = "position:relative;margin:4px 0;";

        const pre = document.createElement("pre");
        pre.style.cssText = [
          "margin:0",
          "white-space:pre-wrap",
          "font-family:monospace",
          "font-size:12px",
          "background:rgba(0,0,0,.3)",
          "border-left:2px solid #6aaff4",
          "padding:4px 8px 4px 8px",
          "border-radius:2px",
          "padding-right:56px", // room for button
        ].join(";");
        pre.innerHTML = syntaxHighlight(pretty);

        const btn = document.createElement("button");
        btn.textContent = "Copy";
        btn.style.cssText = [
          "position:absolute",
          "top:4px",
          "right:4px",
          "padding:1px 7px",
          "font-size:11px",
          "font-family:sans-serif",
          "background:#6aaff4",
          "color:#000",
          "border:none",
          "border-radius:3px",
          "cursor:pointer",
          "opacity:0.85",
          "line-height:1.6",
        ].join(";");

        btn.addEventListener("click", () => {
          navigator.clipboard
            .writeText(pretty)
            .then(() => {
              btn.textContent = "Copied!";
              setTimeout(() => {
                btn.textContent = "Copy";
              }, 1500);
            })
            .catch(() => {
              // Fallback for older browsers / non-HTTPS
              const ta = document.createElement("textarea");
              ta.value = pretty;
              ta.style.cssText = "position:fixed;opacity:0";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
              btn.textContent = "Copied!";
              setTimeout(() => {
                btn.textContent = "Copy";
              }, 1500);
            });
        });

        wrapper.appendChild(pre);
        wrapper.appendChild(btn);
        fragment.appendChild(wrapper);
      }
    }

    span.innerHTML = "";
    span.appendChild(fragment);
  }

  function checkForPopover() {
    const popover = document.querySelector(
      '[data-test-subj="euiDataGridExpansionPopover"]',
    );
    if (popover) processPopover(popover);
  }

  // Observe the entire body for the popover being added to the DOM
  const observer = new MutationObserver(() => {
    checkForPopover();
  });

  function start() {
    checkForPopover();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(start, 1000);
})();
