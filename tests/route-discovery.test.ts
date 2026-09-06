import assert from "node:assert/strict";
import test from "node:test";
import { discoverFileRoutes, discoverSourceRoutes, extractLinkEdges } from "../lib/route-discovery";

test("discovers Next app and pages routes", () => {
  const routes = discoverFileRoutes(["app/page.tsx", "app/pricing/page.tsx", "app/blog/[slug]/page.tsx", "pages/settings.tsx", "pages/_app.tsx"]);
  assert.deepEqual(routes.map((route) => route.route), ["/", "/blog/[slug]", "/pricing", "/settings"]);
  assert.equal(routes.find((route) => route.route === "/blog/[slug]")?.dynamic, true);
});

test("extracts declared click edges from href and to", () => {
  const edges = extractLinkEdges(`<Link href="/pricing"/><NavLink to='/settings'/>`, "/");
  assert.deepEqual(edges.map((edge) => edge.toRoute), ["/pricing", "/settings"]);
});

test("discovers React Router and Wouter routes from source", () => {
  const routes = discoverSourceRoutes([{ path: "src/App.tsx", content: `<Route path={"/"} /><Route path="/pricing" /><Route path='/users/:id' />` }]);
  assert.deepEqual(routes.map((item) => item.route), ["/", "/pricing", "/users/:id"]);
  assert.equal(routes[2].dynamic, true);
});

test("src roots and route groups map to real URLs, not fictional group paths", () => {
  const routes = discoverFileRoutes(["src/app/(marketing)/page.js", "src/app/(marketing)/pricing/page.tsx", "src/app/account/page.ts", "src/app/@modal/(.)login/page.tsx", "src/app/(..)intercept/page.tsx", "src/pages/_error.js", "src/pages/api/status.ts", "src/pages/help/index.jsx"]);
  assert.deepEqual(routes.map(route => route.route), ["/", "/account", "/help", "/pricing"]);
  assert.equal(routes[0].file, "src/app/(marketing)/page.js");
});
