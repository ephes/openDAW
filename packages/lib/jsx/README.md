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

The runtime owns both visible and pending page lifecycles and pending preloaders.
Disposing it stops navigation and fences late completions. Cancelling a request
terminates its resources immediately, even when its factory never settles.

## Routing error boundary

Synchronous throws and promise rejections share the same routing error boundary.
A failed page lifecycle is closed before the optional error factory runs; its
context receives the failure text in `error`. The error factory is attempted only
once. If it also fails, Router logs the failure, clears its loader and preserves
the last valid page. Without an error factory the existing alert reports failure.
Once a page is published, a throwing `onshow` (or DOM replacement) is only
logged: the visible page and its lifecycle stay alive and no error page runs.

## Route matching

Routes consume all path segments; `/a/b` does not match `/a`. A `*` segment
explicitly accepts the remaining path, including an empty remainder (`/a/*`
also matches `/a`). One trailing slash is ignored on paths and route declarations.
RouteLocation subscribes before initial delivery so synchronous factory redirects
are observed. A throwing initial observer is unsubscribed before rethrowing.
`LocalLink` highlighting is a section match instead (`RouteMatcher.isWithin`):
a link to `/manuals/` stays `active` on `/manuals/...` pages.

## Local validation

After the root build, `npm test --workspace=@opendaw/lib-jsx` runs the TSX/DOM
regressions with Vitest and jsdom. `npm run lint --workspace=@opendaw/lib-jsx`
checks both TypeScript and TSX. Root build, lint and test remain the full gates.

## Await attempts

Each repeat or retry starts a new attempt. Only the latest attempt may render
success or failure; retry callbacks from superseded errors do nothing. Factory
throws, rejected promises and success/loading renderer throws use the same failure
renderer. Failure callbacks receive an `unknown` rejection reason (Errors are
formatted as text); narrow or stringify it before rendering. If that renderer
throws, Await logs it once and displays
`Could not load content.`; a later explicit repeat can still recover.

## Reusable DOM bindings

One attribute injector can bind several keys on the same element and can be
shared across elements. Updating or toggling it changes every bound attribute.
Termination detaches all bindings without removing their last DOM values; a later
explicit binding starts afresh. Class-list injectors own the complete `class`
attribute, with the same add/remove/toggle behavior for HTML and SVG. Their
termination also stops updates while preserving the last rendered classes.
