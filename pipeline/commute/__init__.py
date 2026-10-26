"""Commuter data for Georgia Tech and UGA: campus geometry and transit timetables.

    python -m pipeline.commute.campus     buildings, entrances, parking geometry (OpenStreetMap)
    python -m pipeline.commute.transit    compact timetables (MARTA, UGA Campus Transit, ACC Transit GTFS)

Hand-verified rules (parking, night services, service calendars, events) live in
data/commute/*.json; this package only builds geometry and schedules.
"""
