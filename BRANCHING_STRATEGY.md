# Branching Strategy

## Overview

We use a **PR-based branching strategy** where each Pull Request gets its own dedicated branch. This ensures clean separation of features, easy code review, and clear history.

## Branch Naming Convention

Branches follow the pattern: `pr{N}-{short-description}`

### Examples:
- `pr1-project-foundation` - PR1: Project Foundation & Scaffolding
- `pr2-prompt-builder-asset-upload` - PR2: Prompt Builder & Asset Upload
- `pr3-mvp-deterministic-pipeline` - PR3: MVP Deterministic Pipeline
- `pr4-agentic-langgraph-workflow` - PR4: Agentic LangGraph Workflow
- `pr5-scene-board-frame-control` - PR5: Scene Board & First/Last Frame Control
- `pr6-brand-kit-asset-management` - PR6: Brand Kit & Asset Management
- `pr7-telemetry-cost-dashboard` - PR7: Telemetry, Cost Tracking & Progress Dashboard
- `pr8-quality-polish-optimizations` - PR8: Quality Polish & Final Optimizations

## Branch Structure

```
main (production-ready, always deployable)
  ├─ pr1-project-foundation ✅ (merged)
  ├─ pr2-prompt-builder-asset-upload (current)
  ├─ pr3-mvp-deterministic-pipeline
  ├─ pr4-agentic-langgraph-workflow
  ├─ pr5-scene-board-frame-control
  ├─ pr6-brand-kit-asset-management
  ├─ pr7-telemetry-cost-dashboard
  └─ pr8-quality-polish-optimizations
```

## Workflow

### Creating a New PR Branch

1. **Ensure you're on main and up to date:**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create and switch to new PR branch:**
   ```bash
   git checkout -b pr{N}-{short-description}
   ```

3. **Push branch to remote:**
   ```bash
   git push -u origin pr{N}-{short-description}
   ```

### Working on a PR Branch

1. **Make your changes:**
   ```bash
   # Make code changes
   git add .
   git commit -m "feat: add feature description"
   ```

2. **Keep branch updated with main (if needed):**
   ```bash
   git checkout main
   git pull origin main
   git checkout pr{N}-{short-description}
   git merge main
   # Resolve conflicts if any
   ```

3. **Push updates:**
   ```bash
   git push origin pr{N}-{short-description}
   ```

### Completing a PR

1. **Create Pull Request on GitHub:**
   - Title: `PR{N}: {Full Description}`
   - Description: Link to implementation plan section
   - Base: `main`
   - Compare: `pr{N}-{short-description}`

2. **After PR is approved and merged:**
   ```bash
   git checkout main
   git pull origin main
   git branch -d pr{N}-{short-description}  # Delete local branch
   git push origin --delete pr{N}-{short-description}  # Delete remote branch (optional)
   ```

## Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

### Examples:
```bash
git commit -m "feat: add prompt builder form component"
git commit -m "fix: resolve asset upload validation issue"
git commit -m "docs: update API documentation"
git commit -m "test: add unit tests for scene planner"
```

## PR Checklist

Before creating a PR, ensure:

- [ ] Branch is up to date with `main`
- [ ] All tests pass (`npm test`)
- [ ] Code is linted (`npm run lint`)
- [ ] TypeScript compiles without errors
- [ ] Commit messages follow convention
- [ ] PR description includes:
  - What was implemented
  - How to test
  - Screenshots (if UI changes)
  - Related issue/PR number

## Quick Reference

### Current PR Branches

| PR | Branch Name | Status |
|----|-------------|--------|
| PR1 | `pr1-project-foundation` | ✅ Merged |
| PR2 | `pr2-prompt-builder-asset-upload` | 🚧 In Progress |
| PR3 | `pr3-mvp-deterministic-pipeline` | ⏳ Pending |
| PR4 | `pr4-agentic-langgraph-workflow` | ⏳ Pending |
| PR5 | `pr5-scene-board-frame-control` | ⏳ Pending |
| PR6 | `pr6-brand-kit-asset-management` | ⏳ Pending |
| PR7 | `pr7-telemetry-cost-dashboard` | ⏳ Pending |
| PR8 | `pr8-quality-polish-optimizations` | ⏳ Pending |

### Useful Commands

```bash
# List all branches
git branch -a

# List PR branches only
git branch | grep pr

# Switch to a PR branch
git checkout pr{N}-{short-description}

# See which branch you're on
git branch --show-current

# View branch status
git status
```

## Best Practices

1. **One PR = One Branch**: Never mix multiple PRs in one branch
2. **Keep PRs Small**: Focus on one feature/change per PR
3. **Regular Commits**: Commit often with descriptive messages
4. **Update from Main**: Regularly merge `main` into your PR branch
5. **Clean History**: Use `git rebase` if needed (before pushing)
6. **Delete After Merge**: Clean up merged branches to keep repo tidy

## Emergency Hotfixes

For urgent production fixes, create a hotfix branch:

```bash
git checkout -b hotfix/{description}
# Make fix
git commit -m "fix: urgent production fix"
git push -u origin hotfix/{description}
# Create PR to main, merge immediately
```

---

**Last Updated**: After PR1 completion
**Next PR**: PR2 - Prompt Builder & Asset Upload

