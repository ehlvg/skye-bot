# Contributing to Skye

Thank you for your interest in contributing to Skye! 🌥️

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Node.js compatible environment
- TypeScript knowledge

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/skye-bot.git
   cd skye-bot
   ```
3. Install dependencies:
   ```bash
   bun install
   ```
4. Copy environment file:
   ```bash
   cp env.example .env
   ```
5. Configure your `.env` file with necessary credentials

## Development Workflow

### Running Locally

```bash
bun run dev
```

### Building

```bash
bun run build
```

### Code Style

This project uses:
- ESLint for linting
- Prettier for code formatting

Run linting:
```bash
bun run lint
```

Format code:
```bash
bun run format
```

## Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Ensure code quality:
   - Follow existing code style
   - Add comments for complex logic
   - Keep functions small and focused

4. Commit your changes:
   ```bash
   git commit -m "feat: add amazing feature"
   ```
   
   Use conventional commits:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `refactor:` for code refactoring
   - `test:` for tests
   - `chore:` for maintenance

5. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

6. Open a Pull Request

## Pull Request Guidelines

- Provide a clear description of the changes
- Reference any related issues
- Ensure all checks pass
- Keep PRs focused on a single concern
- Be responsive to feedback

## Questions?

Feel free to open an issue for any questions or concerns!

---

*Thank you for contributing to making Skye better!* ✨