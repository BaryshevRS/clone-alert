# Security Policy

## Supported versions

clone-alert follows semantic versioning. Only the latest released version on npm
receives security fixes.

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |
| < 1.0   | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's **"Report a vulnerability"** button on the
[Security tab](https://github.com/BaryshevRS/clone-alert/security), which opens a
private advisory. If that is unavailable, email **rugoals@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce (a minimal repo or input is ideal),
- the clone-alert and Node.js versions affected.

You can expect an initial response within a few days. Once a fix is released,
the advisory is published with credit to the reporter (unless you prefer to stay
anonymous).

## Scope

clone-alert is a static analyzer: it **reads** source files and never executes
the code it scans. The most relevant risk classes are denial-of-service on
crafted input (pathological files that hang or exhaust memory) and issues in the
optional template compilers it loads. Both are in scope.
