# Circular source position identity

Parent fix in isolated `cov/w1-ucm-identity-20261006`, base `2fe342b8`.
The full package comparison on that frozen physics/relative candidate matches
the pristine physics batch: 77/2 scene, 42/4 core, 112/5 app green/red counts,
zero changed failure digests. The independent review's previous defects pass.
A further validated full ProblemIR source case names Q=(1.5,-2); the source
geometry is correct but the body is labelled P. That is a correctness defect.

The numeric source now retains the literal point name attached to its Cartesian
tuple. Directed and undirected source programs use that name for the body label;
internal geometry IDs and physical state are unchanged. The existing compiler,
live/save and restore guards regenerate the document from the actual question,
so a submitted name flag or deleted source marker cannot authorize a wrong label.

The rotational kernel already distinguishes single uppercase point identities
from physical value claims. The reader now honestly rejects unsupported A1/q
identities rather than silently renaming them P. Its physical numeric-label
validator is unchanged. The declared label scope is one uppercase base letter
on a supported Cartesian body position, or the conventional P for an unnamed
position. Arbitrary identifiers and multiple bodies remain outside this scope.

The new dedicated gate passes 162 checks: P=, Q=, direct A tuple and unnamed
positions, each clockwise, anticlockwise and without stated sense; radius2.5,
omega2, speed5 and inward acceleration10 are independently expected. A different
valid point letter with source markers removed fails compilation atomically.
Unsupported complex/lowercase names decline in all three sense modes. The
original Q oracle failed before the fix. Scene typecheck, scoped lint and build
pass; the existing UCM399 gate is recorded in coordinator integration logs.

No student render, READY increment, accepted ledger edit, main write or remote
action is claimed here. Independent final review and integrated student checks
remain required before the topic READY record.
