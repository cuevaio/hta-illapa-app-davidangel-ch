import {
	DEFAULT_HTTP_PORT,
	LOOPBACK_HOST,
	MYSQL_DEFAULT_PORT,
} from "./constants";

export interface NodeHyperdrive {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
	connectionString: string;
}

export interface NodeServiceBinding {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface NodeWorkerEnv {
	readonly [name: string]: unknown;
	readonly HYPERDRIVE: NodeHyperdrive;
	readonly SELF: NodeServiceBinding;
}

export const port = Number(process.env.PORT ?? DEFAULT_HTTP_PORT);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"DATABASE_URL is required (mysql://user:password@host:port/database)",
	);
}
const parsedDatabaseUrl = new URL(databaseUrl);

export const env: NodeWorkerEnv = {
	...process.env,
	HYPERDRIVE: {
		host: parsedDatabaseUrl.hostname,
		port: Number(parsedDatabaseUrl.port) || MYSQL_DEFAULT_PORT,
		user: decodeURIComponent(parsedDatabaseUrl.username),
		password: decodeURIComponent(parsedDatabaseUrl.password),
		database: decodeURIComponent(parsedDatabaseUrl.pathname.slice(1)),
		connectionString: databaseUrl,
	},
	SELF: {
		fetch(input, init) {
			const request = new Request(input, init);
			const { pathname, search } = new URL(request.url);
			return fetch(
				new Request(
					`http://${LOOPBACK_HOST}:${port}${pathname}${search}`,
					request,
				),
			);
		},
	},
};
