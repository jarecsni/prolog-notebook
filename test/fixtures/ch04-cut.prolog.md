---
format: prolog-notebook/1
kicker: Cut and control
---

# Where does the fence go?

*You have a rule that answers correctly and says everything twice. The obvious fix
breaks it completely — and which of the two versions breaks depends on one thing only.*

## The database

Nothing surprising here: a small family, four facts about who is male, a handful of
parent links.

```prolog program id="p-family"
male(albert).
male(edward).
male(alfred).
male(george).

female(victoria).
female(alice).

father(albert, edward).
father(albert, alfred).
father(edward, george).

mother(victoria, edward).
mother(victoria, alfred).
mother(alexandra, george).

parent(X, Y) :- father(X, Y) ; mother(X, Y).

% "a son is a male who has a parent"
is_son(X) :- male(X), parent(_, X).
```

## The complaint

Ask for every son. Press **Run** for the first answer, then **; next** to walk through
the rest — exactly as you would type a semicolon at the interpreter's prompt.

```prolog query id="q-is-son"
is_son(X)
```

```text output for="q-is-son" input-hash="0000000000000000"
X = edward ;
X = edward ;
X = alfred ;
X = alfred ;
X = george ;
X = george ;
false.
```

> [!margin] edward, then edward again. Nobody has two fathers.

Every son arrives twice. Not a bug in the definition — the definition is correct.
Edward genuinely is a son, and Prolog genuinely found *two proofs* of it.

> [!aside] **So stop it after the first proof.**
> `once(Goal)` proves `Goal` and then throws away every alternative it found
> along the way.

## Two ways to spell the fix

```prolog program id="p-fixes"
son_a(X) :- once(( male(X), parent(_, X) )).
son_b(X) :- male(X), once(parent(_, X)).
```

> [!predict] Sharpen your pencil
> Write down how many answers you expect from each — then run them.
>
> <details><summary>Reveal the answer (run them first!)</summary>
>
> **A gives exactly one son. B gives three, each once.**
>
> </details>

```prolog query id="q-son-a"
son_a(X)
```

```prolog query id="q-son-b"
son_b(X)
```

> [!bullets] Bullet points
> - Prolog enumerates **proofs**, not answers.
> - Fencing a **test** is free. Fencing a **generator** destroys it.
