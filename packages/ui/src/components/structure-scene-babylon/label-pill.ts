import { Rectangle, TextBlock } from "@babylonjs/gui";
import {
	LABEL_FONT_SIZE_PX,
	LABEL_HEIGHT_PX,
	LABEL_PADDING_PX,
	LABEL_RADIUS_PX,
	LABEL_WIDTH_PX,
} from "./constants";

export interface LabelPill {
	control: Rectangle;
	caption: TextBlock;
}

export function createLabelPill(
	name: string,
	text: string,
	color: string,
	background: string,
	border: string,
): LabelPill {
	const control = new Rectangle(name);
	control.adaptWidthToChildren = true;
	control.widthInPixels = LABEL_WIDTH_PX;
	control.heightInPixels = LABEL_HEIGHT_PX;
	control.cornerRadius = LABEL_RADIUS_PX;
	control.thickness = 1;
	control.color = border;
	control.background = background;
	control.isPointerBlocker = false;
	const caption = new TextBlock(`${name}-caption`, text);
	caption.fontFamily = "Archivo, sans-serif";
	caption.fontSizeInPixels = LABEL_FONT_SIZE_PX;
	caption.heightInPixels = LABEL_HEIGHT_PX;
	caption.color = color;
	caption.paddingLeftInPixels = LABEL_PADDING_PX;
	caption.paddingRightInPixels = LABEL_PADDING_PX;
	caption.resizeToFit = true;
	control.addControl(caption);
	return { control, caption };
}
