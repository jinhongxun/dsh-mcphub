/*!
 * dsh-mcphub — client half (browser bundle).
 *
 * Registers an "MCP" section in the settings panel: per-server connection
 * status (green dot = tools registered), tool counts, pip/npx upgrade badges
 * with one-click upgrade, connectivity probe, an add-server form that writes
 * cordis.patch.yml through the host RPC, and usage help.
 *
 * Bundle format: the official DSH client-bundle shape — a lazy-CJS closure
 * registered with window.__ModuleLoader__.load({ id, factory }). `react` is
 * an external resolved from the shell's module table at runtime. Host RPC
 * uses the client-connection channel /dsh-mcphub via plain fetch with the
 * client-request envelope.
 */
window.__ModuleLoader__.load({
  id: "dsh-mcphub",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";

    var import_react = require("react");
    var h = import_react.createElement;

    /* ------------------------------------------------------------------ */
    /* Host RPC (client-connection envelope over plain fetch)              */
    /* ------------------------------------------------------------------ */

    var rpcSeq = 0;
    function rpc(endpoint, payload) {
      rpcSeq += 1;
      var rid = "mcphub-" + rpcSeq;
      return fetch("/dsh-mcphub/" + endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: rid,
          method: endpoint,
          payload: payload == null ? {} : payload,
        }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (full) {
          if (full.rpcId !== rid) throw new Error("rpcId mismatch");
          return full.result;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Styles                                                              */
    /* ------------------------------------------------------------------ */

    var CSS = [
      ".mcphub{display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary);padding:2px 0 24px}",
      ".mcphub *{box-sizing:border-box}",
      ".mcphub-head{display:flex;flex-direction:column;gap:6px}",
      ".mcphub-title{font-size:15px;font-weight:600}",
      ".mcphub-path{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
      ".mcphub-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".mcphub-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;line-height:1.5}",
      ".mcphub-btn:hover{background:var(--dsw-alias-bg-layer-2)}",
      ".mcphub-btn[disabled]{opacity:.5;cursor:default}",
      ".mcphub-btn.primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}",
      ".mcphub-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
      ".mcphub-badge.off{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);opacity:.8}",
      ".mcphub-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:8px}",
      ".mcphub-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".mcphub-name{font-weight:600;font-size:13px}",
      ".mcphub-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}",
      ".mcphub-dot.on{background:var(--dsw-alias-state-success-primary)}",
      ".mcphub-dot.off{background:var(--dsw-alias-label-secondary);opacity:.45}",
      ".mcphub-badge{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}",
      ".mcphub-badge.warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}",
      ".mcphub-badge.ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}",
      ".mcphub-target{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
      ".mcphub-tools{background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:8px 10px;font-size:12px;display:flex;flex-direction:column;gap:4px;word-break:break-all;max-height:220px;overflow:auto}",
      ".mcphub-mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}",
      ".mcphub-ok{color:var(--dsw-alias-state-success-primary)}",
      ".mcphub-err{color:var(--dsw-alias-state-error-primary)}",
      ".mcphub-warn{color:var(--dsw-alias-state-warn-primary)}",
      ".mcphub-note{font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".mcphub-result{font-size:12px;border-radius:6px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2);word-break:break-all;white-space:pre-wrap}",
      ".mcphub-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px}",
      ".mcphub-field{display:flex;flex-direction:column;gap:4px}",
      ".mcphub-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".mcphub-input,.mcphub-select,.mcphub-textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:5px 8px;font-size:12px;font-family:inherit;width:100%}",
      ".mcphub-textarea{font-family:ui-monospace,Consolas,monospace;min-height:64px;resize:vertical}",
      ".mcphub-kv{display:flex;gap:6px;align-items:center}",
      ".mcphub-kv .mcphub-input{flex:1 1 0;min-width:0}",
      ".mcphub-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".mcphub-link{color:var(--dsw-alias-brand-primary);cursor:pointer;background:none;border:none;padding:0;font-size:12px}",
      ".mcphub-help{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:8px}",
      ".mcphub-help b{color:var(--dsw-alias-label-primary)}",
      ".mcphub-help pre{background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:8px 10px;overflow:auto;font-size:11px;margin:0}",
      ".mcphub-spacer{flex:1 1 auto}",
    ].join("\n");

    /* ------------------------------------------------------------------ */
    /* Small components                                                    */
    /* ------------------------------------------------------------------ */

    function Badge(props) {
      return h(
        "span",
        { className: "mcphub-badge" + (props.tone ? " " + props.tone : "") },
        props.children,
      );
    }

    function ServerCard(props) {
      var s = props.server;
      var up = props.upgrade || null;
      var probeState = props.probeState || null;
      var upgState = props.upgState || null;
      var open = !!props.open;
      var tools =
        open && s.toolCount > 0
          ? s.sampleTools.map(function (t) {
              return h(
                "div",
                { key: t.name, className: "mcphub-mono" },
                t.name + (t.description ? " — " + t.description : ""),
              );
            })
          : [];

      var transportBadge =
        s.transport === "stdio" ? "stdio" : s.transport === "streamable-http" ? "HTTP" : s.transport;
      var pkgBadge =
        s.managedKind === "pip"
          ? h(
              Badge,
              { tone: "ok", key: "pkg" },
              "pip · " + s.packageName + (s.installedVersion ? " " + s.installedVersion : ""),
            )
          : s.managedKind === "npm"
            ? h(
                Badge,
                { key: "pkg" },
                "npm · " + s.packageName + (s.latestTag ? "（@latest 自动最新）" : ""),
              )
            : null;
      var upBadge =
        up && up.kind === "npm" && up.refreshed
          ? h(Badge, { tone: "ok", key: "up" }, "已刷新缓存，重启后生效")
          : up && up.upgradable && up.latestVersion
            ? h(
                Badge,
                { tone: "warn", key: "up" },
                (s.installedVersion ? s.installedVersion + " → " : "可升级 ") + up.latestVersion,
              )
            : up && up.kind === "npm" && up.latestVersion
              ? h(Badge, { key: "up" }, "最新 " + up.latestVersion)
              : null;

      var headChildren = [
        h(
          "span",
          {
            key: "dot",
            className: "mcphub-dot " + (s.connected ? "on" : "off"),
            title: s.connected ? "已连接" : "未注册工具（未加载或连接失败）",
          },
        ),
        h("span", { key: "name", className: "mcphub-name" }, s.name),
        h(Badge, { key: "tp" }, transportBadge),
        h(Badge, { key: "tc" }, s.toolCount + " 个工具"),
        pkgBadge,
        upBadge,
        s.disabled ? h(Badge, { key: "dis", tone: "warn" }, "已暂停") : null,
        s.source === "live" ? h(Badge, { key: "src", tone: "warn" }, "配置外来源") : null,
        h("span", { key: "sp", className: "mcphub-spacer" }),
      ];
      if (up && up.upgradable && up.kind === "pip") {
        headChildren.push(
          h(
            "button",
            {
              key: "upbtn",
              className: "mcphub-btn primary",
              disabled: !!(upgState && upgState.running),
              onClick: function () {
                props.onUpgrade(s.name, s.packageRecognized === false ? props.pkgInput(s.name) : null);
              },
            },
            upgState && upgState.running ? "升级中…" : "升级",
          ),
        );
      }
      if (s.managedKind === "npm" && !s.latestTag) {
        headChildren.push(
          h(
            "button",
            {
              key: "npmbtn",
              className: "mcphub-btn",
              disabled: !!(upgState && upgState.running),
              onClick: function () {
                props.onUpgrade(s.name, null);
              },
            },
            upgState && upgState.running ? "处理中…" : "刷新缓存",
          ),
        );
      }
      headChildren.push(
        h(
          "button",
          {
            key: "probebtn",
            className: "mcphub-btn",
            disabled: !!(probeState && probeState.running),
            onClick: function () {
              props.onProbe(s.name);
            },
          },
          probeState && probeState.running ? "测试中…" : "测试",
        ),
      );
      if (s.toolCount > 0) {
        headChildren.push(
          h(
            "button",
            {
              key: "tgbtn",
              className: "mcphub-btn",
              onClick: function () {
                props.onToggle(s.name);
              },
            },
            open ? "收起" : "工具",
          ),
        );
      }
      if (s.source === "config") {
        headChildren.push(
          h(
            "button",
            {
              key: "disbtn",
              className: "mcphub-btn",
              disabled: !!(props.busyMap && props.busyMap[s.name]),
              onClick: function () {
                props.onToggleDisabled(s.name, !s.disabled);
              },
            },
            props.busyMap && props.busyMap[s.name]
              ? "处理中…"
              : s.disabled
                ? "恢复"
                : "暂停",
          ),
        );
        headChildren.push(
          h(
            "button",
            {
              key: "delbtn",
              className: "mcphub-btn danger",
              disabled: !!(props.busyMap && props.busyMap[s.name]),
              onClick: function () {
                var msg = s.disabled
                  ? "确定删除 MCP 服务器「" + s.name + "」？\n\n将从配置文件移除该条目（重启 DSH 后彻底卸载）。"
                  : "确定删除 MCP 服务器「" + s.name + "」？\n\n将从配置文件移除该条目，重启 DSH 后其工具彻底消失。此操作不可在面板内撤销（需手动重新配置）。";
                if (typeof window !== "undefined" && window.confirm(msg)) props.onDelete(s.name);
              },
            },
            "删除",
          ),
        );
      }

      var details = [h("div", { key: "target", className: "mcphub-target" }, s.target || "(无目标地址)")];
      if (s.profile) {
        details.push(
          h(
            "div",
            { key: "meta", className: "mcphub-note" },
            "profile: " +
              s.profile +
              (s.headerKeys && s.headerKeys.length ? " · headers: " + s.headerKeys.join(", ") : "") +
              (s.envKeys && s.envKeys.length ? " · env: " + s.envKeys.join(", ") : ""),
          ),
        );
      }
      if (s.managedKind === "pip" && s.packageRecognized === false) {
        details.push(
          h(
            "div",
            { key: "pkg", className: "mcphub-row" },
            h("span", { className: "mcphub-note" }, "未能把可执行文件名匹配到 pip 包，可手动指定包名："),
            h("input", {
              className: "mcphub-input mcphub-mono",
              style: { width: "180px" },
              defaultValue: "",
              onChange: function (e) {
                props.setPkgInput(s.name, e.target.value);
              },
              placeholder: "pip 包名",
            }),
          ),
        );
      }
      if (upgState && upgState.result) {
        var ur = upgState.result;
        details.push(
          h(
            "div",
            { key: "upgres", className: "mcphub-result " + (ur.ok ? "mcphub-ok" : "mcphub-err") },
            (ur.ok ? "✓ " : "✗ ") +
              (ur.message || "") +
              (ur.fromVersion || ur.toVersion
                ? "\n版本: " + (ur.fromVersion || "?") + " → " + (ur.toVersion || "?")
                : "") +
              (ur.restartRequired ? "\n⚠ 该 MCP 服务器的进程仍在运行旧版本，重启 DSH 后新版本生效。" : "") +
              (ur.outputTail ? "\n" + ur.outputTail : ""),
          ),
        );
      }
      if (probeState && probeState.result) {
        var pr = probeState.result;
        details.push(
          h(
            "div",
            { key: "proberes", className: "mcphub-result " + (pr.ok ? "mcphub-ok" : "mcphub-err") },
            (pr.ok ? "✓ " : "✗ ") +
              (pr.detail || "") +
              (typeof pr.ms === "number" ? "（" + pr.ms + "ms）" : "") +
              (pr.httpCode ? " · HTTP " + pr.httpCode : ""),
          ),
        );
      }
      if (open && tools.length > 0) {
        details.push(h("div", { key: "tools", className: "mcphub-tools" }, tools));
      }

      return h(
        "div",
        { className: "mcphub-card" },
        h("div", { className: "mcphub-card-head" }, headChildren),
        details,
      );
    }

    function AddForm(props) {
      var profiles = props.profiles || [];
      var serverNameState = import_react.useState("");
      var serverName = serverNameState[0];
      var setServerName = serverNameState[1];
      var transportState = import_react.useState("streamable-http");
      var transport = transportState[0];
      var setTransport = transportState[1];
      var urlState = import_react.useState("");
      var url = urlState[0];
      var setUrl = urlState[1];
      var commandState = import_react.useState("");
      var command = commandState[0];
      var setCommand = commandState[1];
      var argsState = import_react.useState("");
      var argsText = argsState[0];
      var setArgsText = argsState[1];
      var headerState = import_react.useState([{ k: "Authorization", v: "" }]);
      var headerRows = headerState[0];
      var setHeaderRows = headerState[1];
      var envState = import_react.useState([]);
      var envRows = envState[0];
      var setEnvRows = envState[1];
      var profileState = import_react.useState(props.activeProfile || (profiles.length > 0 ? profiles[0].name : ""));
      var profile = profileState[0];
      var setProfile = profileState[1];
      var busyState = import_react.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var resultState = import_react.useState(null);
      var result = resultState[0];
      var setResult = resultState[1];

      var submit = async function () {
        setBusy(true);
        setResult(null);
        try {
          var headers = {};
          for (var i = 0; i < headerRows.length; i++) {
            if (headerRows[i].k.trim() !== "") headers[headerRows[i].k.trim()] = headerRows[i].v;
          }
          var env = {};
          for (var j = 0; j < envRows.length; j++) {
            if (envRows[j].k.trim() !== "") env[envRows[j].k.trim()] = envRows[j].v;
          }
          var args = argsText
            .split("\n")
            .map(function (t) {
              return t.trim();
            })
            .filter(function (t) {
              return t !== "";
            });
          var payload = { serverName: serverName.trim(), transport: transport, profile: profile };
          if (transport === "streamable-http") {
            payload.url = url.trim();
            payload.headers = headers;
          } else {
            payload.command = command.trim();
            payload.args = args;
            payload.env = env;
          }
          var r = await rpc("create", payload);
          setResult(r);
          if (r && r.ok) {
            setServerName("");
            setUrl("");
            setCommand("");
            setArgsText("");
            setHeaderRows([{ k: "Authorization", v: "" }]);
            setEnvRows([]);
            if (props.onCreated) props.onCreated();
          }
        } catch (e) {
          setResult({ ok: false, error: String((e && e.message) || e) });
        }
        setBusy(false);
      };

      var kvRows = function (rows, setRows, keyName, valName, addLabel) {
        return h(
          "div",
          { className: "mcphub-field" },
          h("label", null, keyName + " / " + valName),
          rows.map(function (r, i) {
            return h(
              "div",
              { className: "mcphub-kv", key: String(i) },
              h("input", {
                className: "mcphub-input mcphub-mono",
                value: r.k,
                placeholder: keyName,
                onChange: function (e) {
                  var n = rows.slice();
                  n[i] = { k: e.target.value, v: r.v };
                  setRows(n);
                },
              }),
              h("input", {
                className: "mcphub-input mcphub-mono",
                value: r.v,
                placeholder: valName,
                type: "text",
                onChange: function (e) {
                  var n = rows.slice();
                  n[i] = { k: r.k, v: e.target.value };
                  setRows(n);
                },
              }),
              h(
                "button",
                {
                  className: "mcphub-btn",
                  onClick: function () {
                    setRows(
                      rows.filter(function (_, idx) {
                        return idx !== i;
                      }),
                    );
                  },
                },
                "×",
              ),
            );
          }),
          h(
            "button",
            {
              className: "mcphub-btn",
              onClick: function () {
                setRows(rows.concat([{ k: "", v: "" }]));
              },
            },
            addLabel,
          ),
        );
      };

      var children = [
        h(
          "div",
          { key: "g1", className: "mcphub-grid2" },
          h(
            "div",
            { className: "mcphub-field" },
            h("label", null, "serverName（唯一标识，字母/数字/_/-，≤32 字符）"),
            h("input", {
              className: "mcphub-input mcphub-mono",
              value: serverName,
              onChange: function (e) {
                setServerName(e.target.value);
              },
              placeholder: "例如 my-search",
            }),
          ),
          h(
            "div",
            { className: "mcphub-field" },
            h("label", null, "传输类型"),
            h(
              "select",
              {
                className: "mcphub-select",
                value: transport,
                onChange: function (e) {
                  setTransport(e.target.value);
                },
              },
              h("option", { value: "streamable-http" }, "streamable-http（远程 HTTP）"),
              h("option", { value: "stdio" }, "stdio（本地命令）"),
            ),
          ),
        ),
      ];
      // Beginner-friendly explainer: always visible, not only when several
      // profiles exist — this is the #1 confusing field in the form.
      children.push(
        h(
          "div",
          { key: "profnote", className: "mcphub-note", style: { background: "var(--dsw-alias-bg-layer-2)", borderRadius: "6px", padding: "8px 10px", lineHeight: "1.7" } },
          "💡 什么是 profile？它是 DSH 的「独立配置环境」（类似浏览器的多用户配置）：每个 profile 有自己的插件和 MCP 列表，互不影响。" +
            (profiles.length > 1
              ? "你这台机器有 " +
                profiles.length +
                " 个 profile，写入哪个，重启后就只有哪个环境的 DSH 会加载这个新服务器。不确定选哪个？保持默认「" +
                (props.activeProfile || profile) +
                "」（你日常网页版在用的）即可。"
              : "你当前只有 1 个 profile（" + (props.activeProfile || profile || "默认") + "），新服务器会写入它，无需选择。"),
        ),
      );
      if (profiles.length > 1) {
        children.push(
          h(
            "div",
            { key: "prof", className: "mcphub-field" },
            h("label", null, "写入的 profile"),
            h(
              "select",
              {
                className: "mcphub-select",
                value: profile,
                onChange: function (e) {
                  setProfile(e.target.value);
                },
              },
              profiles.map(function (p) {
                return h("option", { key: p.name, value: p.name }, p.name);
              }),
            ),
          ),
        );
      }
      if (transport === "streamable-http") {
        children.push(
          h(
            "div",
            { key: "url", className: "mcphub-field" },
            h("label", null, "服务器 URL"),
            h("input", {
              className: "mcphub-input mcphub-mono",
              value: url,
              onChange: function (e) {
                setUrl(e.target.value);
              },
              placeholder: "https://example.com/mcp",
            }),
          ),
        );
        children.push(
          h("div", { key: "hdr" }, kvRows(headerRows, setHeaderRows, "Header 名", "Header 值（如 Bearer xxx）", "+ 添加 Header")),
        );
      } else {
        children.push(
          h(
            "div",
            { key: "cmd", className: "mcphub-field" },
            h("label", null, "command（可执行文件路径）"),
            h("input", {
              className: "mcphub-input mcphub-mono",
              value: command,
              onChange: function (e) {
                setCommand(e.target.value);
              },
              placeholder: "C:/path/to/server.exe 或 npx",
            }),
          ),
        );
        children.push(
          h(
            "div",
            { key: "args", className: "mcphub-field" },
            h("label", null, "args（每行一个参数）"),
            h("textarea", {
              className: "mcphub-textarea",
              value: argsText,
              onChange: function (e) {
                setArgsText(e.target.value);
              },
              placeholder: "mcp\n或\n-y\n@scope/server",
            }),
          ),
        );
        children.push(h("div", { key: "env" }, kvRows(envRows, setEnvRows, "ENV 名", "ENV 值", "+ 添加环境变量")));
      }
      children.push(
        h(
          "div",
          { key: "act", className: "mcphub-row" },
          h(
            "button",
            { className: "mcphub-btn primary", disabled: busy, onClick: submit },
            busy ? "写入中…" : "写入配置文件",
          ),
          h("span", { className: "mcphub-note" }, "写入后需重启 DSH 才会连接新服务器"),
        ),
      );
      if (result) {
        if (result.ok) {
          children.push(
            h(
              "div",
              { key: "res", className: "mcphub-result mcphub-ok" },
              "✓ " + (result.message || "已写入") + "\n⚠ 重启 DSH 后生效。",
            ),
          );
        } else {
          children.push(
            h("div", { key: "res", className: "mcphub-result mcphub-err" }, "✗ " + (result.error || "失败")),
          );
          if (result.snippet) {
            children.push(
              h(
                "div",
                { key: "snip", className: "mcphub-field" },
                h(
                  "label",
                  null,
                  "自动写入失败。请手动把以下内容追加到 " + (result.path || "profile 的 cordis.patch.yml") + "：",
                ),
                h("textarea", { className: "mcphub-textarea", readOnly: true, value: result.snippet }),
              ),
            );
          }
        }
      }
      return h("div", { className: "mcphub-panel" }, children);
    }

    var HELP_YAML =
      "- id: mcp-my-server\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: my-server\n    transport: streamable-http\n    url: https://example.com/mcp\n    headers:\n      Authorization: 'Bearer <你的密钥>'";

    function HelpBlock() {
      return h(
        "div",
        { className: "mcphub-panel mcphub-help" },
        h(
          "div",
          null,
          h("b", null, "这是什么？"),
          " 本面板管理通过 ",
          h("code", null, "@deepseek-ai/dsh-mcp-client"),
          " 接入的 MCP 服务器。绿点表示该服务器的工具已成功注册进当前会话（AI 可以调用）；灰点表示已配置但工具未注册（连接失败或尚未加载）。",
        ),
        h(
          "div",
          null,
          h("b", null, "让 AI 使用 MCP 工具："),
          " 工具命名为 ",
          h("code", null, "mcp__<服务器名>__<工具名>"),
          "。直接在对话里说「用 playwright 打开 xxx」「用 context7 查一下 React hooks 文档」即可，无需手动指定工具名。这也是最可靠的连通性验证方式。",
        ),
        h(
          "div",
          null,
          h("b", null, "新增 MCP 服务器："),
          " 用上方表单，或手动编辑配置文件（每台服务器一个条目，改完重启 DSH 生效）：",
          h("pre", null, HELP_YAML),
          h(
            "div",
            null,
            "stdio 型本地服务器把 transport 换成 ",
            h("code", null, "stdio"),
            "，用 command / args / env 字段；serverName 只能含字母、数字、下划线、连字符（≤32 字符）且全局唯一。",
          ),
        ),
        h(
          "div",
          null,
          h("b", null, "暂停 / 恢复 / 删除："),
          " 「暂停」临时停用一个服务器（配置保留，显示「已暂停」徽标，点「恢复」即可还原）；「删除」从配置文件移除该条目，不可在面板内撤销。两者都要重启 DSH 才真正生效——在那之前它的工具可能仍显示为已连接。",
        ),
        h(
          "div",
          null,
          h("b", null, "profile 是什么："),
          " DSH 的独立配置环境（类似浏览器的多用户配置），每个 profile 有自己的插件和 MCP 列表。例：机器上可以有「web」（日常网页版）和「open-design」（给设计软件用）两套，各配各的 MCP 互不影响。添加表单里的 profile 选择就是决定写入哪套环境——只有一个 profile 时无需关心。",
        ),
        h(
          "div",
          null,
          h("b", null, "本地安装的升级："),
          " pip 安装的 stdio 服务器（如 scrapling）会自动比对 PyPI 最新版并显示「可升级」徽标，点「升级」执行 pip install --upgrade；npx 型服务器点「刷新缓存」后下次启动拉取最新版。",
          h(
            "div",
            { className: "mcphub-warn" },
            "⚠ 升级只更新磁盘上的包；正在运行的 stdio 子进程仍是旧版本，必须重启 DSH 才会用新版。",
          ),
        ),
        h(
          "div",
          null,
          h("b", null, "安全提醒："),
          " 配置文件中的 headers / env 含 API 密钥，勿提交 git、勿截图外传。本面板不会把密钥值发到浏览器端。",
        ),
        h(
          "div",
          null,
          h("b", null, "排障："),
          " 灰点/连接失败时先点「测试」看握手结果；HTTP 401/403 通常是密钥失效，超时通常是网络或服务端问题；stdio 型失败检查可执行文件路径。配置改动（含新增、升级）都需要重启 DSH 才会生效。",
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Main section                                                        */
    /* ------------------------------------------------------------------ */

    function McpSection() {
      var dataState = import_react.useState(null);
      var data = dataState[0];
      var setData = dataState[1];
      var errState = import_react.useState(null);
      var err = errState[0];
      var setErr = errState[1];
      var loadedState = import_react.useState(false);
      var loaded = loadedState[0];
      var setLoaded = loadedState[1];
      var openState = import_react.useState({});
      var openMap = openState[0];
      var setOpenMap = openState[1];
      var probesState = import_react.useState({});
      var probes = probesState[0];
      var setProbes = probesState[1];
      var upgStateMap = import_react.useState({});
      var upgStates = upgStateMap[0];
      var setUpgStates = upgStateMap[1];
      var upgradesState = import_react.useState({});
      var upgrades = upgradesState[0];
      var setUpgrades = upgradesState[1];
      var checkState = import_react.useState(false);
      var checkRun = checkState[0];
      var setCheckRun = checkState[1];
      var formState = import_react.useState(false);
      var formOpen = formState[0];
      var setFormOpen = formState[1];
      var helpState = import_react.useState(false);
      var helpOpen = helpState[0];
      var setHelpOpen = helpState[1];
      var pkgState = import_react.useState({});
      var pkgInputs = pkgState[0];
      var setPkgInputs = pkgState[1];
      var restartState = import_react.useState(false);
      var pendingRestart = restartState[0];
      var setPendingRestart = restartState[1];

      var dataRef = import_react.useRef(null);

      var load = async function () {
        try {
          var d = await rpc("list", {});
          dataRef.current = d;
          setData(d);
          setErr(null);
          return d;
        } catch (e) {
          setErr(String((e && e.message) || e));
          return null;
        }
      };
      var checkUpgrades = async function (d) {
        var src = d || dataRef.current;
        if (!src || !src.ok) return;
        var names = (src.servers || [])
          .filter(function (s) {
            return s.managedKind === "pip" || (s.managedKind === "npm" && !s.latestTag);
          })
          .map(function (s) {
            return s.name;
          });
        if (names.length === 0) return;
        setCheckRun(true);
        try {
          var r = await rpc("check-upgrades", { names: names });
          if (r && r.ok) setUpgrades(r.upgrades || {});
        } catch (e) {}
        setCheckRun(false);
      };

      import_react.useEffect(function () {
        var alive = true;
        var boot = async function () {
          var d = await load();
          if (!alive) return;
          setLoaded(true);
          checkUpgrades(d);
        };
        boot();
        var timer = setInterval(function () {
          load();
        }, 20000);
        return function () {
          alive = false;
          clearInterval(timer);
        };
      }, []);

      var doProbe = async function (name) {
        setProbes(function (p) {
          var n = Object.assign({}, p);
          n[name] = { running: true };
          return n;
        });
        try {
          var r = await rpc("probe", { name: name });
          setProbes(function (p) {
            var n = Object.assign({}, p);
            n[name] = { result: r };
            return n;
          });
        } catch (e) {
          setProbes(function (p) {
            var n = Object.assign({}, p);
            n[name] = { result: { ok: false, detail: String((e && e.message) || e) } };
            return n;
          });
        }
      };
      var doUpgrade = async function (name, pkgOverride) {
        setUpgStates(function (p) {
          var n = Object.assign({}, p);
          n[name] = { running: true };
          return n;
        });
        try {
          var args = { name: name };
          if (pkgOverride) args.packageName = pkgOverride;
          var r = await rpc("upgrade", args);
          setUpgStates(function (p) {
            var n = Object.assign({}, p);
            n[name] = { result: r };
            return n;
          });
          if (r && r.ok) {
            setPendingRestart(true);
            var d = await load();
            checkUpgrades(d);
          }
        } catch (e) {
          setUpgStates(function (p) {
            var n = Object.assign({}, p);
            n[name] = { result: { ok: false, message: String((e && e.message) || e) } };
            return n;
          });
        }
      };
      var toggle = function (name) {
        setOpenMap(function (m) {
          var n = Object.assign({}, m);
          n[name] = !n[name];
          return n;
        });
      };

      var busyStateMap = import_react.useState({});
      var busyMap = busyStateMap[0];
      var setBusyMap = busyStateMap[1];
      var withBusy = async function (name, fn) {
        setBusyMap(function (m) {
          var n = Object.assign({}, m);
          n[name] = true;
          return n;
        });
        try {
          await fn();
        } finally {
          setBusyMap(function (m) {
            var n = Object.assign({}, m);
            n[name] = false;
            return n;
          });
        }
      };
      var doToggleDisabled = function (name, wantDisabled) {
        withBusy(name, async function () {
          try {
            var r = await rpc("set-disabled", { name: name, disabled: wantDisabled });
            if (r && r.ok) setPendingRestart(true);
            else if (r && r.error) setErr("暂停/恢复失败：" + r.error);
            await load();
          } catch (e) {
            setErr(String((e && e.message) || e));
          }
        });
      };
      var doDelete = function (name) {
        withBusy(name, async function () {
          try {
            var r = await rpc("delete", { name: name });
            if (r && r.ok) setPendingRestart(true);
            else if (r && r.error) setErr("删除失败：" + r.error);
            await load();
          } catch (e) {
            setErr(String((e && e.message) || e));
          }
        });
      };

      var servers = data && data.ok ? data.servers || [] : [];
      var connectedCount = servers.filter(function (s) {
        return s.connected;
      }).length;
      var disabledCount = servers.filter(function (s) {
        return s.disabled;
      }).length;
      var upgradableCount = servers.filter(function (s) {
        return upgrades[s.name] && upgrades[s.name].upgradable;
      }).length;

      var headChildren = [
        h("span", { key: "t", className: "mcphub-title" }, "MCP 服务器"),
        h("span", { key: "sp", className: "mcphub-spacer" }),
        h(
          "button",
          {
            key: "chk",
            className: "mcphub-btn",
            disabled: checkRun,
            onClick: function () {
              checkUpgrades(null);
            },
          },
          checkRun ? "检查更新中…" : "检查更新",
        ),
        h(
          "button",
          {
            key: "rl",
            className: "mcphub-btn",
            onClick: function () {
              load();
            },
          },
          "刷新",
        ),
        h(
          "button",
          {
            key: "add",
            className: "mcphub-btn primary",
            onClick: function () {
              setFormOpen(!formOpen);
            },
          },
          formOpen ? "收起表单" : "+ 添加 MCP 服务器",
        ),
      ];
      var head = h(
        "div",
        { className: "mcphub-head" },
        h("div", { className: "mcphub-row" }, headChildren),
        pendingRestart
          ? h("div", { className: "mcphub-note mcphub-warn" }, "⚠ 有变更待生效：重启 DSH 后新配置 / 新版本才会加载。")
          : null,
        data && data.ok
          ? h(
              "div",
              { className: "mcphub-path" },
              (data.activeProfile ? "profile: " + data.activeProfile + " · " : "") +
                servers.length +
                " 个服务器 · " +
                connectedCount +
                " 个已连接" +
                (disabledCount > 0 ? " · " + disabledCount + " 个已暂停" : "") +
                (upgradableCount > 0 ? " · " + upgradableCount + " 个可升级" : "") +
                (data.home ? " · " + data.home + "/profiles/" + (data.activeProfile || "") + "/cordis.patch.yml" : ""),
            )
          : null,
        err ? h("div", { className: "mcphub-result mcphub-err" }, "加载失败：" + err) : null,
      );

      var cards = servers.map(function (s) {
        return h(ServerCard, {
          key: s.name,
          server: s,
          upgrade: upgrades[s.name] || null,
          probeState: probes[s.name] || null,
          upgState: upgStates[s.name] || null,
          open: !!openMap[s.name],
          onToggle: toggle,
          onProbe: doProbe,
          onUpgrade: doUpgrade,
          onToggleDisabled: doToggleDisabled,
          onDelete: doDelete,
          busyMap: busyMap,
          pkgInput: function (n) {
            return pkgInputs[n] || null;
          },
          setPkgInput: function (n, v) {
            setPkgInputs(function (m) {
              var x = Object.assign({}, m);
              x[n] = v;
              return x;
            });
          },
        });
      });

      return h(
        "div",
        { className: "mcphub" },
        head,
        !loaded && !err ? h("div", { className: "mcphub-note" }, "加载中…") : null,
        loaded && data && data.ok && servers.length === 0
          ? h(
              "div",
              { className: "mcphub-note" },
              "没有发现已配置的 MCP 服务器。用上方「+ 添加 MCP 服务器」创建一个。",
            )
          : null,
        cards.length > 0 ? h("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } }, cards) : null,
        formOpen
          ? h(AddForm, {
              profiles: data && data.ok ? data.profiles : [],
              activeProfile: data && data.ok ? data.activeProfile : null,
              onCreated: function () {
                setPendingRestart(true);
                load();
              },
            })
          : null,
        h(
          "div",
          { className: "mcphub-row" },
          h(
            "button",
            {
              className: "mcphub-link",
              onClick: function () {
                setHelpOpen(!helpOpen);
              },
            },
            helpOpen ? "收起使用说明" : "使用说明 ▾",
          ),
        ),
        helpOpen ? h(HelpBlock) : null,
      );
    }

    /* ------------------------------------------------------------------ */
    /* Plugin entry                                                        */
    /* ------------------------------------------------------------------ */

    // No hard cordis service dependencies: the panel uses ctx.get("slots")
    // optionally. NOTE: package.json dsh.client.inject is MODULE-load
    // ordering metadata for the wire graph — those bundle ids must NEVER be
    // repeated here as service dependencies, or this fiber waits forever for
    // services that do not exist and the whole web boot hangs.
    var inject = [];

    function apply(ctx) {
      ctx.effect(function () {
        var style = document.createElement("style");
        style.setAttribute("data-dsh-mcphub", "");
        style.textContent = CSS;
        document.head.appendChild(style);
        return function () {
          if (style.parentNode) style.parentNode.removeChild(style);
        };
      });

      var slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("settings.section", function () {
        return slots.register(
          { name: "settings.section", id: "mcphub", order: 55, label: "MCP" },
          function () {
            return h(McpSection);
          },
        );
      });
    }

    module.exports = { inject: inject, apply: apply };
    return module.exports;
  },
});
