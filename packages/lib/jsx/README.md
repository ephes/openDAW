_This package is part of the openDAW SDK_

# @opendaw/lib-jsx

JSX utilities and components for TypeScript projects with DOM manipulation.

## Core JSX

* **create-element.ts** - JSX element creation and factory functions
* **types.ts** - TypeScript type definitions for JSX
* **inject.ts** - Dependency injection utilities for JSX components

## Component System

* **weak.ts** - Weak reference utilities for components
* **routes.ts** - Routing utilities and navigation
* **supported-svg-tags.ts** - SVG tag support definitions

## Standard Components

* **Frag.tsx** - Fragment component for grouping elements
* **Group.tsx** - Grouping component with enhanced functionality
* **Await.tsx** - Async component for handling promises
* **Router.tsx** - Router component for navigation
* **Hotspot.tsx** - Interactive hotspot component
* **LocalLink.tsx** - Local navigation link component
* **Preloader.tsx** - Loading and preloading component
## Navigation ownership

Router keeps the visible page while its replacement loads. Returning to the
visible path cancels pending navigation. Retired requests cannot publish content
or invoke the error page, including when they reject after a later page appears.

## Local validation

After the root build, `npm test --workspace=@opendaw/lib-jsx` runs the TSX/DOM
regressions with Vitest and jsdom. `npm run lint --workspace=@opendaw/lib-jsx`
checks both TypeScript and TSX. Root build, lint and test remain the full gates.

The runtime owns both visible and pending page lifecycles and pending preloaders.
Disposing it stops navigation and fences late completions. Cancelling a request
terminates its resources immediately, even when its factory never settles.

Synchronous throws and promise rejections share the same routing error boundary.
A failed page lifecycle is closed before the optional error factory runs; its
context receives the failure text in `error`. The error factory is attempted only
once. If it also fails, Router logs the failure, clears its loader and preserves
the last valid page. Without an error factory the existing alert reports failure.
