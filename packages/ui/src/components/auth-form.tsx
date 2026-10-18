import { MIN_PASSWORD_LENGTH_CHARS } from "@hack-the-andes-project/business/constants";
import { useState } from "react";
import { z } from "zod";

import { MIN_NAME_LENGTH_CHARS } from "../constants";
import { Alert, AlertDescription } from "./alert";
import { Button } from "./button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "./field";
import { Input } from "./input";
import { PasswordInput } from "./password-input";

export type AuthMode = "sign-in" | "sign-up";

export interface AuthFormValues {
	name: string;
	email: string;
	password: string;
}

interface AuthFieldErrors {
	name?: string[];
	email?: string[];
	password?: string[];
}

export interface AuthModeLabels {
	title: string;
	description: string;
	submit: string;
	pending: string;
	switchPrompt: string;
	switchAction: string;
}

export interface AuthFormLabels {
	signIn: AuthModeLabels;
	signUp: AuthModeLabels;
	name: string;
	namePlaceholder: string;
	email: string;
	emailPlaceholder: string;
	password: string;
	passwordHint: (minimumLength: number) => string;
	invalidEmail: string;
	passwordRequired: string;
	nameTooShort: (minimumLength: number) => string;
	passwordTooShort: (minimumLength: number) => string;
}

const AUTH_CONTROL_CLASS_NAME =
	"type-body h-10 text-foreground focus-visible:ring-ring! md:type-body";

export interface AuthFormProps {
	mode: AuthMode;
	labels: AuthFormLabels;
	onModeChange: (mode: AuthMode) => void;
	onSubmit: (values: AuthFormValues) => Promise<string | undefined>;
}

export function AuthForm({
	mode,
	labels,
	onModeChange,
	onSubmit,
}: AuthFormProps) {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
	const [submitError, setSubmitError] = useState<string>();
	const isSignUp = mode === "sign-up";
	const modeLabels = isSignUp ? labels.signUp : labels.signIn;

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-2">
				<h2 className="type-title text-foreground">{modeLabels.title}</h2>
				<p className="type-body text-muted-foreground">
					{modeLabels.description}
				</p>
			</div>
			<form
				noValidate
				className="flex flex-col gap-6"
				onSubmit={async (event) => {
					event.preventDefault();
					const formData = new FormData(event.currentTarget);
					const signInSchema = z.object({
						name: z.string(),
						email: z.email(labels.invalidEmail),
						password: z.string().min(1, labels.passwordRequired),
					});
					const parsedValues = (
						isSignUp
							? signInSchema.extend({
									name: z
										.string()
										.trim()
										.min(
											MIN_NAME_LENGTH_CHARS,
											labels.nameTooShort(MIN_NAME_LENGTH_CHARS),
										),
									password: z
										.string()
										.min(
											MIN_PASSWORD_LENGTH_CHARS,
											labels.passwordTooShort(MIN_PASSWORD_LENGTH_CHARS),
										),
								})
							: signInSchema
					).safeParse({
						name: String(formData.get("name") ?? ""),
						email: String(formData.get("email") ?? ""),
						password: String(formData.get("password") ?? ""),
					});
					setSubmitError(undefined);
					if (!parsedValues.success) {
						setFieldErrors(z.flattenError(parsedValues.error).fieldErrors);
						return;
					}
					setFieldErrors({});
					setIsSubmitting(true);
					try {
						setSubmitError(await onSubmit(parsedValues.data));
					} finally {
						setIsSubmitting(false);
					}
				}}
			>
				<fieldset disabled={isSubmitting} className="min-w-0">
					<FieldGroup>
						{isSignUp && (
							<Field data-invalid={Boolean(fieldErrors.name)}>
								<FieldLabel
									className="font-medium font-sans text-sm normal-case tracking-normal"
									htmlFor="auth-name"
								>
									{labels.name}
								</FieldLabel>
								<Input
									id="auth-name"
									name="name"
									autoComplete="name"
									placeholder={labels.namePlaceholder}
									aria-invalid={Boolean(fieldErrors.name)}
									className={AUTH_CONTROL_CLASS_NAME}
								/>
								<FieldError className="type-body text-destructive">
									{fieldErrors.name?.[0]}
								</FieldError>
							</Field>
						)}
						<Field data-invalid={Boolean(fieldErrors.email)}>
							<FieldLabel
								className="font-medium font-sans text-sm normal-case tracking-normal"
								htmlFor="auth-email"
							>
								{labels.email}
							</FieldLabel>
							<Input
								id="auth-email"
								name="email"
								type="email"
								autoComplete="email"
								placeholder={labels.emailPlaceholder}
								aria-invalid={Boolean(fieldErrors.email)}
								className={AUTH_CONTROL_CLASS_NAME}
							/>
							<FieldError className="type-body text-destructive">
								{fieldErrors.email?.[0]}
							</FieldError>
						</Field>
						<Field data-invalid={Boolean(fieldErrors.password)}>
							<FieldLabel
								className="font-medium font-sans text-sm normal-case tracking-normal"
								htmlFor="auth-password"
							>
								{labels.password}
							</FieldLabel>
							<PasswordInput
								id="auth-password"
								name="password"
								autoComplete={isSignUp ? "new-password" : "current-password"}
								aria-invalid={Boolean(fieldErrors.password)}
								groupClassName="h-10"
							/>
							{fieldErrors.password ? (
								<FieldError className="type-body text-destructive">
									{fieldErrors.password[0]}
								</FieldError>
							) : (
								isSignUp && (
									<FieldDescription className="type-body">
										{labels.passwordHint(MIN_PASSWORD_LENGTH_CHARS)}
									</FieldDescription>
								)
							)}
						</Field>
					</FieldGroup>
				</fieldset>
				{submitError && (
					<Alert variant="destructive">
						<AlertDescription className="text-destructive">
							{submitError}
						</AlertDescription>
					</Alert>
				)}
				<Button
					type="submit"
					size="lg"
					className="w-full"
					disabled={isSubmitting}
				>
					{isSubmitting ? modeLabels.pending : modeLabels.submit}
				</Button>
			</form>
			<p className="type-body text-center text-muted-foreground">
				{modeLabels.switchPrompt}{" "}
				<Button
					variant="link"
					className="h-auto p-0"
					onClick={() => onModeChange(isSignUp ? "sign-in" : "sign-up")}
				>
					{modeLabels.switchAction}
				</Button>
			</p>
		</div>
	);
}
