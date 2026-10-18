import { createFileRoute } from "@tanstack/react-router";

import { DemoSignIn } from "@/components/demo-sign-in";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/demo")({
	head: () => ({ meta: [{ title: m.demo_page_title() }] }),
	component: () => <DemoSignIn profile="fleet" />,
});
