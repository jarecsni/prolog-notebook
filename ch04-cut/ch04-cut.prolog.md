---
format: prolog-notebook/1
kicker: Cut and control
---

# Where does the fence go?

*You have a rule that answers correctly and says everything twice. The obvious fix
breaks it completely — and which of the two versions breaks depends on one thing only.*

## The database

Nothing surprising here: a small family, four facts about who is male, a handful of
parent links. Everything further down this page runs against it.

```prolog program id="p-family"
male(albert).
male(edward).
male(alfred).
male(george).

female(victoria).
female(alice).
female(maud).

father(albert, edward).
father(albert, alice).
father(albert, alfred).
father(edward, george).
father(edward, maud).

mother(victoria, edward).
mother(victoria, alice).
mother(victoria, alfred).
mother(alexandra, george).
mother(alexandra, maud).

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

```text output for="q-is-son" input-hash="a4de5ef3d4e5798a"
X = edward ;
X = edward ;
X = alfred ;
X = alfred ;
X = george ;
X = george.
```

> [!margin] edward, then edward again. Nobody has two fathers.

Every son arrives twice. Not a bug in the definition — the definition is correct. Edward
genuinely is a son, and Prolog genuinely found *two proofs* of it: one through
`father(albert, edward)`, one through `mother(victoria, edward)`. Prolog reports proofs,
not conclusions. Two proofs, two answers.

> [!aside] **So stop it after the first proof.**
> `once(Goal)` proves `Goal` and then throws away every alternative it found along the
> way. It is `call(Goal), !` in a polite wrapper. Exactly the tool for this — assuming you
> put it in the right place.

## Two places to put it

Here are the only two sensible placements. Version **A** fences the whole body. Version
**B** fences only the parent lookup. They differ by two parentheses.

```prolog program id="p-fixes"
% A — the fence encloses everything, male(X) included
son_a(X) :- once(( male(X), parent(_, X) )).

% B — the fence encloses only the parent lookup
son_b(X) :- male(X), once(parent(_, X)).
```

> [!predict] Sharpen your pencil
> Both rules are correct for a single yes/no question: `son_a(edward)` and `son_b(edward)`
> both succeed. But we are about to ask each one to *list every son*. Write down how many
> answers you expect from each — then run them.
>
> <details><summary>Reveal the answer (run them first!)</summary>
>
> **A gives exactly one son. B gives three, each once.**
>
> `once` discards the choice points created *inside* it — and it can only reach what is
> inside. In A, `male(X)` is inside the fence, so the very goal that *generates*
> candidates is what gets silenced. The body succeeds once, with edward, and there is
> nothing left to retry.
>
> In B, `male(X)` sits outside. Backtracking walks it freely — albert, edward, alfred,
> george — and for each one the fenced lookup is proved at most once. Duplicates gone,
> sons intact.
>
> </details>

```prolog query id="q-son-a" rerun="auto" hold="until-answered"
son_a(X)
```

```text output for="q-son-a" input-hash="a4480ceaf6456068"
X = edward.
```

```prolog query id="q-son-b" rerun="auto" hold="until-answered"
son_b(X)
```

```text output for="q-son-b" input-hash="55957a2f818a0831"
X = edward ;
X = alfred ;
X = george.
```

## The rule underneath

It is tempting to file this under "A is wrong, B is right" and move on. That would be
learning the answer instead of the lesson. Look again at *why* B is safe:

By the time control reaches the fence in B, `male(X)` has already bound `X` to a person.
The goal inside the fence is therefore asking a yes/no question about edward — it is a
**test**. Throwing away its second proof costs nothing, because we never cared *which*
parent, only *whether*.

In A, the fence closes around `male(X)` while `X` is still unbound. There the enclosed
goal is a **generator**, and `once` strangles it.

> [!aside] **Fence a test, never a generator.**
> And notice that "test" and "generator" are not properties of a predicate. They are
> properties of a goal *at the moment it is called*, decided entirely by what is already
> bound — which is decided entirely by goal order.

Which is why the same predicate can be either. Try it: `son_b(george)` is a test,
`son_b(X)` is a generator, and it is the same three lines of Prolog both times.

```prolog query id="q-son-b-george"
son_b(george)
```

```text output for="q-son-b-george" input-hash="113d3dfd84740780"
true.
```

> [!bullets] Bullet points
> - Prolog enumerates **proofs**, not answers. Duplicate answers mean duplicate proofs —
>   look for the goal that succeeded more than one way.
> - `once(G)` is `call(G), !`. It discards choice points created *inside* it, and cannot
>   touch those created before it.
> - Fencing a **test** is free. Fencing a **generator** destroys it.
> - Whether a goal is a test or a generator depends on what is bound when it runs, and so
>   it depends on goal order. In Prolog, order is not merely about speed.
> - There is another way entirely — leave the rule pure and clean up at collection time
>   with `setof/3`. That is the next section's argument.
