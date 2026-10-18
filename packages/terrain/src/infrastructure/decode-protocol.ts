export interface DecodeRequest {
	id: number;
	buffer: ArrayBuffer;
}

export interface DecodedHeightTile {
	heights: Uint16Array;
	offset: number;
	width: number;
	height: number;
	min: number;
	max: number;
}

export interface DecodeResponse {
	id: number;
	tile?: DecodedHeightTile;
	error?: string;
}
