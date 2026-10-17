---
name: Bounty
about: A task with money locked on chain behind it
title: ""
labels: bounty
---

<!--
  La forma es fija a propósito. Un agente que lea cinco de estos tiene que
  encontrar siempre las mismas tres cosas: qué cuenta como terminado, dónde
  puede escribir, y qué número va en el pull request.
  AGENTS.md, tarea 3b, le dice exactamente eso.
-->

**What this is for**

<!-- Una o dos frases. Qué falta y por qué importa. -->

**What done looks like**

<!--
  Criterios comprobables, no opiniones. Si una línea no se puede responder con
  sí o no mirando el diff y el CI, no va aquí.
-->

- [ ]
- [ ]

**Where it goes**

<!-- Las rutas que este bounty puede tocar. Nada de agent/ ni action.yml. -->

- `contracts/test/…`

**Bounty: #N**

<!--
  Se rellena cuando el bounty está financiado on-chain. Quien tome la tarea
  copia esta línea en la descripción de su pull request: es lo que el agente
  lee para saber qué liquidar.
-->

---

**How this gets paid.** The money is already locked on GIWA Sepolia, in public, before anyone
starts. Put `Bounty: #N` in your pull request description. When it is merged with CI green, the
agent pays the author's wallet by itself and comments the receipt here.

So the agent knows which wallet is yours, either put one line naming Mergit and your address in
the README of your GitHub profile repository (free, nothing to sign), or register your login at
https://www.mergit.xyz/register.

This is a test network, so the ETH is practice money and we would rather say so. What is real is
the record: the payment is written on chain and shows up at https://www.mergit.xyz/p/&lt;your login&gt;.

**One bounty, one payment.** The first pull request merged takes it.
