import TripView from './trip-view';

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripView key={id} tripId={id} />;
}
