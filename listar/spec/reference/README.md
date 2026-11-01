# Archived Listar design artifacts

These are unchanged downloads from the locally exported
[2026-10-28–29 conversation](https://chatgpt.com/c/6ae2a36e-e7b0-83e9-a9ce-8783b960058d).
Use [the integration design](../contextual-commands.md) for repository scope.
Neither archive is loaded by the app or its production tests.

| Archive | Contents | Verification limits |
| --- | --- | --- |
| [Categorical Specodelic pack](listar-categorical-specodelic-validated.zip) | Five specs, model, scenarios, reference checker, validation log | Historical lint/graph/compile pass; 24 unchecked claims; property placeholders; no formal proof |
| [Source audit and prototype](listar-audit-and-prototype.zip) | REPORT.md, independent transition module, ten example tests, splitter baseline | Experimental JS only; no atomic IndexedDB integration or browser verification |

Original files are under
`~/cotorreo/raw/_conversations/chatgpt/6ae2a36e-e7b0-83e9-a9ce-8783b960058d/artifacts/`.
Their SHA-256 digests, for checking the preserved copies, are:

```text
838983dbb02af9d4f471b90eb62fb1f34a77a597e5856b0725029acdeaf4b96a  listar-categorical-specodelic-validated.zip
e349e1e9febde48835b940516439fcd153304f2dc5a65dfeec5292d9d11fc439  listar-audit-and-prototype.zip
```

The older noncategorical and unvalidated bundles remain in the local export.
The included validation log describes the original environment, not a fresh run
against this repository. Do not import the prototype as production code without
reviewing its validators, monetary arithmetic and persistence assumptions.
