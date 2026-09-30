"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface Location {
  lat: number;
  lng: number;
  address?: string;
}

interface RideMapProps {
  pickup?: Location | null;
  dropoff?: Location | null;
  className?: string;
  onRouteCalculated?: (distance: number, duration: number) => void;
}

const TORONTO_CENTER = { lat: 43.6532, lng: -79.3832 };

export default function RideMap({ pickup, dropoff, className = "", onRouteCalculated }: RideMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const init = () => {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: TORONTO_CENTER,
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
        styles: [
          { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "simplified" }] },
          { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#c9e9f6" }] },
          { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#f0e6ff" }] },
        ],
      });

      mapInstanceRef.current = map;

      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#6366f1",
          strokeWeight: 5,
          strokeOpacity: 0.8,
        },
      });

      setMapReady(true);
    };

    // Wait for Maps JS API — may load after mount with async loading
    if (window.google?.maps) {
      init();
    } else {
      pollId = setInterval(() => {
        if (window.google?.maps) {
          if (pollId) clearInterval(pollId);
          pollId = null;
          init();
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
  }, []);

  // Update markers and route
  const updateMap = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    // Clear existing markers
    pickupMarkerRef.current?.setMap(null);
    dropoffMarkerRef.current?.setMap(null);

    // Add pickup marker
    if (pickup) {
      pickupMarkerRef.current = new google.maps.Marker({
        position: { lat: pickup.lat, lng: pickup.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#22c55e",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
        title: "Pickup",
      });
    }

    // Add dropoff marker
    if (dropoff) {
      dropoffMarkerRef.current = new google.maps.Marker({
        position: { lat: dropoff.lat, lng: dropoff.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#ef4444",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
        title: "Dropoff",
      });
    }

    // Calculate route if both points exist
    if (pickup && dropoff) {
      const directionsService = new google.maps.DirectionsService();
      directionsService.route(
        {
          origin: { lat: pickup.lat, lng: pickup.lng },
          destination: { lat: dropoff.lat, lng: dropoff.lng },
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) {
            directionsRendererRef.current?.setDirections(result);
            const leg = result.routes[0]?.legs[0];
            if (leg?.distance?.value && leg?.duration?.value) {
              onRouteCalculated?.(
                leg.distance.value / 1000, // km
                leg.duration.value / 60    // minutes
              );
            }
          }
        }
      );
    } else {
      // Clear route
      directionsRendererRef.current?.setDirections({ routes: [] } as any);

      // Zoom to single marker
      if (pickup) map.panTo({ lat: pickup.lat, lng: pickup.lng });
      else if (dropoff) map.panTo({ lat: dropoff.lat, lng: dropoff.lng });
    }
  }, [pickup, dropoff, mapReady, onRouteCalculated]);

  useEffect(() => {
    updateMap();
  }, [updateMap]);

  return (
    <div className={`relative ${className}`}>
      <div ref={mapRef} className="w-full h-full rounded-2xl" />
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-2xl">
          <div className="text-gray-400 text-sm">Loading map...</div>
        </div>
      )}
    </div>
  );
}
