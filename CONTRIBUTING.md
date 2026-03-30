# Contributing

## Branch Naming Convention

All work should be done in feature branches. **Never commit directly to `main`.**

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/group-bookings` |
| `fix/` | Bug fixes | `fix/slot-count-decrement` |
| `chore/` | Maintenance, refactors, CI | `chore/update-dependencies` |

## Workflow

1. Create a branch from `main` using the naming convention above.
2. Make your changes with clear, focused commits.
3. Open a Pull Request against `main`.
4. Ensure CI passes (lint + tests).
5. Request review and address feedback.
6. Squash-merge into `main`.

## Running Tests

```bash
npx vitest          # watch mode
npx vitest run      # single run
npx vitest run --coverage  # with coverage
```

## Linting

```bash
npx eslint .
```

## Code Style

- Use TypeScript strict mode.
- Follow existing patterns in the codebase.
- Use Tailwind semantic tokens — never hardcode colors in components.
- Keep components small and focused.
