import RideView from './ride-view';

export default async function RidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RideView key={id} rideId={id} />;
}
