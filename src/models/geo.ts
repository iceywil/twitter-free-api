/** Ported from twikit/geo.py */

import { TwitterException } from '../errors.js';
import type { Client } from '../client/client.js';

export class Place {
  /** The ID of the place. */
  readonly id: string;
  /** The name of the place. */
  readonly name: string;
  /** The full name of the place. */
  readonly fullName: string;
  /** The country where the place is located. */
  readonly country: string;
  /** The ISO 3166-1 alpha-2 country code of the place. */
  readonly countryCode: string;
  /** The URL providing more information about the place. */
  readonly url: string;
  /** The type of place. */
  readonly placeType: string;
  readonly attributes: Record<string, unknown> | null;
  /** The bounding box that defines the geographical area of the place. */
  readonly boundingBox: Record<string, unknown>;
  /** The geographical center of the place, as latitude and longitude. */
  readonly centroid: number[] | null;
  /** Places that contain this place. */
  readonly containedWithin: Place[];

  constructor(
    private readonly client: Client,
    data: Record<string, any>
  ) {
    this.id = data.id;
    this.name = data.name;
    this.fullName = data.full_name;
    this.country = data.country;
    this.countryCode = data.country_code;
    this.url = data.url;
    this.placeType = data.place_type;
    this.attributes = data.attributes ?? null;
    this.boundingBox = data.bounding_box;
    this.centroid = data.centroid ?? null;
    this.containedWithin = (data.contained_within ?? []).map(
      (place: Record<string, any>) => new Place(client, place)
    );
  }

  /** Re-fetches this place and returns the fresh instance. */
  async update(): Promise<Place> {
    return this.client.getPlace(this.id);
  }

  equals(other: unknown): boolean {
    return other instanceof Place && this.id === other.id;
  }

  toString(): string {
    return `<Place id="${this.id}" name="${this.name}">`;
  }
}

export function placesFromResponse(client: Client, response: Record<string, any>): Place[] {
  if (response.errors) {
    const error = response.errors[0];
    if (error.code === 6) {
      // No data available for the given coordinate — upstream warns rather than throws.
      console.warn(error.message);
    } else {
      throw new TwitterException(error.message);
    }
  }

  const places = response.result ? response.result.places : [];
  return (places ?? []).map((place: Record<string, any>) => new Place(client, place));
}
