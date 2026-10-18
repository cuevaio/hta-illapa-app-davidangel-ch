export {
	ArrowUpIcon,
	BellIcon,
	ChevronRightIcon,
	CloudLightningIcon,
	DiamondIcon as SignalBaseline,
	ExternalLinkIcon,
	EyeIcon,
	EyeOffIcon,
	MapIcon,
	MapPinIcon,
	Moon,
	NewspaperIcon,
	PlusIcon,
	RouteIcon,
	SettingsIcon,
	Sun,
	TriangleAlertIcon,
	TruckIcon,
	ViewIcon,
} from "lucide-react";
export {
	EarthquakeIcon,
	FireIcon,
	FloodIcon,
	FloodWarningIcon,
	HazmatIcon,
	INCIDENT_CATEGORY_ICONS,
	LandslideIcon,
	MedicalIcon,
	OtherIncidentIcon,
	RainWarningIcon,
	RescueIcon,
	RoadAccidentIcon,
	RoadBlockIcon,
	RoadWorksIcon,
	WeatherIcon,
	WildfireIcon,
} from "./incident-icons";

export function SignalConfirmed({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			className={className}
		>
			<circle cx="12" cy="12" r="8" />
		</svg>
	);
}

export function SignalForecast({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
			className={className}
		>
			<circle cx="12" cy="12" r="7" />
		</svg>
	);
}
