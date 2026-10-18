"use client";

import { useEffect, useState } from "react";

import {
	FONT_SIZE_DEFAULT,
	FONT_SIZE_OPTIONS,
	FONT_SIZE_STORAGE_KEY,
} from "../constants";

export interface FontSizePreference {
	fontSize: (typeof FONT_SIZE_OPTIONS)[number];
	setFontSize: (fontSize: FontSizePreference["fontSize"]) => void;
}

export function useFontSize(): FontSizePreference {
	const [fontSize, setFontSizeState] = useState<FontSizePreference["fontSize"]>(
		() => {
			try {
				const savedFontSize = window.localStorage.getItem(
					FONT_SIZE_STORAGE_KEY,
				);
				return (
					FONT_SIZE_OPTIONS.find((option) => option === savedFontSize) ??
					FONT_SIZE_DEFAULT
				);
			} catch {
				return FONT_SIZE_DEFAULT;
			}
		},
	);

	useEffect(() => {
		document.documentElement.dataset.fontSize = fontSize;
	}, [fontSize]);

	return {
		fontSize,
		setFontSize: (selectedFontSize) => {
			setFontSizeState(selectedFontSize);
			document.documentElement.dataset.fontSize = selectedFontSize;
			try {
				window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, selectedFontSize);
			} catch {
				return;
			}
		},
	};
}
