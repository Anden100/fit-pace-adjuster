# AGENTS.md - Agent Guidelines for fitfix Repository

This document provides guidelines for AI coding agents working in the fitfix repository. It contains build commands, code style conventions, and operational guidelines to ensure consistent code quality and development practices.

## Recent Projects

- **FIT Pace Adjuster** (`fit-pace-adjuster/`): A lightweight web tool for adjusting paces in Garmin FIT files for treadmill running activities. Built with Alpine.js and the Garmin FIT JavaScript SDK, designed for static hosting on GitHub Pages.

## Table of Contents
1. [Build, Lint, and Test Commands](#build-lint-and-test-commands)
2. [Code Style Guidelines](#code-style-guidelines)
3. [Cursor Rules](#cursor-rules)
4. [Copilot Instructions](#copilot-instructions)
5. [Agent Operational Guidelines](#agent-operational-guidelines)

## Build, Lint, and Test Commands

### Build Commands
```bash
# Full project build
npm run build

# Development build with watch mode
npm run dev

# Production build
npm run build:prod

# Clean build artifacts
npm run clean
```

### Lint Commands
```bash
# Lint all files
npm run lint

# Lint and auto-fix issues
npm run lint:fix

# Type checking
npm run typecheck

# Format code
npm run format
```

### Test Commands
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run a single test file
npm test -- path/to/test/file.test.js

# Run tests matching a pattern
npm test -- --grep "test pattern"

# Run specific test suite
npm run test:suite -- suite-name

# Debug tests
npm run test:debug
```

### Development Workflow
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run pre-commit checks
npm run precommit
```

## Code Style Guidelines

### File Structure and Organization
- Use kebab-case for file names: `user-profile.tsx`, `api-client.ts`
- Group related files in directories: `components/`, `utils/`, `types/`
- Place test files next to implementation files: `component.tsx` and `component.test.tsx`
- Use `index.ts` files for clean imports from directories

### Imports and Dependencies
```typescript
// 1. React imports (if applicable)
import React, { useState, useEffect } from 'react';

// 2. Third-party libraries
import { z } from 'zod';
import axios from 'axios';

// 3. Internal imports - absolute paths preferred
import { User } from '@/types/user';
import { apiClient } from '@/utils/api';

// 4. Relative imports only for files in same directory
import { helper } from './helpers';

// 5. Type-only imports
import type { UserProfile } from '@/types/user';
```

**Import Rules:**
- Group imports by category with empty lines between groups
- Sort imports alphabetically within each group
- Use absolute imports with `@/` prefix for internal modules
- Prefer named imports over default imports
- Use type-only imports for TypeScript types

### TypeScript Guidelines

#### Type Definitions
```typescript
// Use interfaces for object shapes
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

// Use types for unions and complex types
type UserStatus = 'active' | 'inactive' | 'suspended';
type ApiResponse<T> = {
  data: T;
  error?: string;
  status: number;
};

// Prefer interfaces over types for object definitions
// Use types for primitives, unions, and tuples
```

#### Typing Best Practices
- Always provide explicit return types for functions
- Always end statements with semicolons
- Use `unknown` instead of `any` when type is uncertain
- Leverage utility types: `Partial<T>`, `Pick<T>`, `Omit<T>`
- Use const assertions for literal types: `['a', 'b'] as const`
- Avoid function overloads unless necessary

### Naming Conventions

#### Variables and Functions
```typescript
// camelCase for variables and functions
const userName = 'john';
function getUserData() {}

// PascalCase for components and classes
function UserProfile() {}
class ApiService {}

// UPPER_CASE for constants
const API_BASE_URL = 'https://api.example.com';
const MAX_RETRIES = 3;

// Prefix with underscore for private members
class UserService {
  private _apiKey: string;
}
```

#### Files and Directories
- Components: `UserProfile.tsx`
- Utilities: `format-date.ts`
- Types: `user.types.ts`
- Tests: `component.test.tsx`
- Hooks: `useAuth.ts`
- Constants: `constants.ts`

### React Component Guidelines

#### Component Structure
```typescript
interface UserCardProps {
  user: User;
  onEdit?: (user: User) => void;
}

export function UserCard({ user, onEdit }: UserCardProps) {
  // Custom hooks at the top
  const { data, loading } = useUserData(user.id);

  // Event handlers
  const handleEdit = () => {
    onEdit?.(user);
  };

  // Early returns for loading/error states
  if (loading) return <div>Loading...</div>;

  return (
    <div className="user-card">
      <h3>{user.name}</h3>
      <button onClick={handleEdit}>Edit</button>
    </div>
  );
}
```

#### Component Best Practices
- Use functional components with hooks
- Destructure props at the function signature
- Define event handlers as arrow functions or useCallback for performance
- Handle loading and error states explicitly
- Use semantic HTML elements
- Prefer composition over inheritance

### Error Handling

#### Async Operations
```typescript
// Prefer async/await over promises
async function fetchUser(id: string): Promise<User> {
  try {
    const response = await apiClient.get(`/users/${id}`);
    return response.data;
  } catch (error) {
    // Log error for debugging
    console.error('Failed to fetch user:', error);

    // Re-throw with context
    throw new Error(`Failed to fetch user ${id}: ${error.message}`);
  }
}

// Handle errors in components
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUser(userId)
      .then(setUser)
      .catch((err) => setError(err.message));
  }, [userId]);

  if (error) return <div>Error: {error}</div>;
  if (!user) return <div>Loading...</div>;

  return <div>Welcome {user.name}!</div>;
}
```

#### Error Types
- Create custom error classes for specific error types
- Use error boundaries for React components
- Log errors with context for debugging
- Provide user-friendly error messages

### Code Formatting

#### General Rules
- Use 2 spaces for indentation (no tabs)
- Max line length: 100 characters
- Use semicolons
- Single quotes for strings, double for JSX
- Trailing commas in multi-line objects/arrays

#### Code Style
```typescript
// Good: Clear and readable
function calculateTotal(items: CartItem[]): number {
  return items.reduce((total, item) => {
    return total + item.price * item.quantity;
  }, 0);
}

// Avoid: Overly complex expressions
function calculateTotal(items: CartItem[]): number {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}
```

### Testing Guidelines

#### Test Structure
```typescript
// component.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { UserCard } from './UserCard';

describe('UserCard', () => {
  it('displays user name', () => {
    const user = { id: '1', name: 'John Doe' };
    render(<UserCard user={user} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('calls onEdit when edit button is clicked', () => {
    const user = { id: '1', name: 'John Doe' };
    const onEdit = jest.fn();
    render(<UserCard user={user} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(onEdit).toHaveBeenCalledWith(user);
  });
});
```

#### Testing Best Practices
- Test behavior, not implementation details
- Use descriptive test names
- Group related tests in describe blocks
- Mock external dependencies
- Test error states and edge cases
- Aim for high coverage but prioritize meaningful tests

## Cursor Rules

*No Cursor rules found in .cursor/rules/ or .cursorrules*

## Copilot Instructions

*No Copilot instructions found in .github/copilot-instructions.md*

## Agent Operational Guidelines

### Code Review Standards
- Ensure all code follows the style guidelines above
- Verify TypeScript types are correct and complete
- Check that tests are written for new functionality
- Validate that linting passes without errors
- Confirm build succeeds before committing

### Git Workflow Guidelines
- **NEVER automatically add or commit files without explicit user approval**
- Always allow users to test changes locally before committing
- Only stage and commit changes when explicitly requested by the user
- Follow the Git Safety Protocol for all git operations

### Commit Message Conventions
```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat(auth): add user login functionality`
- `fix(api): handle null response in user endpoint`
- `test(utils): add tests for date formatting functions`

### Pull Request Guidelines
- Provide clear description of changes
- Reference related issues
- Include screenshots for UI changes
- Ensure CI checks pass
- Request review from appropriate team members

### Security Considerations
- Never commit sensitive data (API keys, passwords, tokens)
- Use environment variables for configuration
- Validate user input to prevent injection attacks
- Follow principle of least privilege
- Keep dependencies updated to avoid vulnerabilities

### Performance Best Practices
- Optimize bundle size and loading times
- Use appropriate React optimization techniques (memo, useMemo, useCallback)
- Implement proper error boundaries
- Monitor and address performance bottlenecks
- Use lazy loading for large components

This document should be updated as the project evolves and new conventions are established.