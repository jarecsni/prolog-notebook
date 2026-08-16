---
format: prolog-notebook/1
---

A notebook whose saved answer no longer matches the program above it. The hash is wrong
deliberately, which is why this lives in `test/fixtures/` and not in `notebooks/` — a real
chapter is written back by `run` and is self-consistent by construction.

Detecting this on a cold page, with no WebAssembly loaded, is the entire point of storing a
hash rather than recomputing an answer.

```prolog program id="p-family"
male(edward).
father(albert, edward).
is_son(X) :- male(X), father(_, X).
```

```prolog query id="q-is-son"
is_son(X)
```

```text output for="q-is-son" input-hash="0000000000000000"
X = edward ;
false.
```
