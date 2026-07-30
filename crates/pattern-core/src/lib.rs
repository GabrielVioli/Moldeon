use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

const GEOMETRY_EPSILON: f64 = 1e-8;
const CUBIC_SAMPLE_SPACING_MM: f64 = 18.0;
const MAX_CUBIC_STEPS: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vector2 {
    pub x_mm: f64,
    pub y_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point2 {
    pub id: String,
    pub x_mm: f64,
    pub y_mm: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_in: Option<Vector2>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_out: Option<Vector2>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternPiece {
    pub id: String,
    pub name: String,
    pub seam_allowance_mm: f64,
    pub points: Vec<Point2>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternSnapshot {
    pub piece: PatternPiece,
    pub area_mm2: f64,
    pub perimeter_mm: f64,
    pub issues: Vec<String>,
}

#[wasm_bindgen]
pub struct PatternEngine {
    piece: PatternPiece,
}

#[wasm_bindgen]
impl PatternEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            piece: default_skirt_front(),
        }
    }

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        to_js_value(&self.build_snapshot())
    }

    pub fn restore_piece(&mut self, piece: JsValue) -> Result<JsValue, JsValue> {
        let piece: PatternPiece = serde_wasm_bindgen::from_value(piece)
            .map_err(|error| JsValue::from_str(&format!("Molde salvo inválido: {error}")))?;
        validate_piece(&piece)?;
        self.piece = piece;
        to_js_value(&self.build_snapshot())
    }

    pub fn move_point(
        &mut self,
        point_id: &str,
        x_mm: f64,
        y_mm: f64,
    ) -> Result<JsValue, JsValue> {
        if !x_mm.is_finite() || !y_mm.is_finite() {
            return Err(JsValue::from_str(
                "As coordenadas precisam ser números finitos.",
            ));
        }

        if let Some(point) = self.piece.points.iter_mut().find(|point| point.id == point_id) {
            point.x_mm = x_mm;
            point.y_mm = y_mm;
        }

        to_js_value(&self.build_snapshot())
    }

    pub fn move_handle(
        &mut self,
        point_id: &str,
        handle: &str,
        x_mm: f64,
        y_mm: f64,
    ) -> Result<JsValue, JsValue> {
        if !x_mm.is_finite() || !y_mm.is_finite() {
            return Err(JsValue::from_str(
                "As coordenadas da alça precisam ser números finitos.",
            ));
        }

        if let Some(point) = self
            .piece
            .points
            .iter_mut()
            .find(|point| point.id == point_id)
        {
            let vector = Some(Vector2 { x_mm, y_mm });
            match handle {
                "in" => point.handle_in = vector,
                "out" => point.handle_out = vector,
                _ => return Err(JsValue::from_str("A alça precisa ser in ou out.")),
            }
        }

        to_js_value(&self.build_snapshot())
    }

    pub fn set_segment_curve(
        &mut self,
        point_id: &str,
        enabled: bool,
    ) -> Result<JsValue, JsValue> {
        let Some(start_index) = self
            .piece
            .points
            .iter()
            .position(|point| point.id == point_id)
        else {
            return to_js_value(&self.build_snapshot());
        };
        let end_index = (start_index + 1) % self.piece.points.len();
        let delta_x =
            self.piece.points[end_index].x_mm - self.piece.points[start_index].x_mm;
        let delta_y =
            self.piece.points[end_index].y_mm - self.piece.points[start_index].y_mm;

        if enabled {
            self.piece.points[start_index].handle_out = Some(Vector2 {
                x_mm: delta_x / 3.0,
                y_mm: delta_y / 3.0,
            });
            self.piece.points[end_index].handle_in = Some(Vector2 {
                x_mm: -delta_x / 3.0,
                y_mm: -delta_y / 3.0,
            });
        } else {
            self.piece.points[start_index].handle_out = None;
            self.piece.points[end_index].handle_in = None;
        }

        to_js_value(&self.build_snapshot())
    }

    pub fn set_seam_allowance(&mut self, value_mm: f64) -> Result<JsValue, JsValue> {
        if !value_mm.is_finite() {
            return Err(JsValue::from_str("A margem precisa ser um número finito."));
        }

        self.piece.seam_allowance_mm = value_mm.max(0.0);
        to_js_value(&self.build_snapshot())
    }

    pub fn reset(&mut self) -> Result<JsValue, JsValue> {
        self.piece = default_skirt_front();
        to_js_value(&self.build_snapshot())
    }
}

impl Default for PatternEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl PatternEngine {
    fn build_snapshot(&self) -> PatternSnapshot {
        let contour = sample_pattern_contour(&self.piece.points);
        let area_mm2 = polygon_area(&contour);
        let perimeter_mm = polygon_perimeter(&contour);
        let issues = validate_pattern_contour(&contour);

        PatternSnapshot {
            piece: self.piece.clone(),
            area_mm2,
            perimeter_mm,
            issues,
        }
    }
}

fn default_skirt_front() -> PatternPiece {
    PatternPiece {
        id: "skirt-front".to_string(),
        name: "Saia base — frente".to_string(),
        seam_allowance_mm: 10.0,
        points: vec![
            Point2 {
                id: "waist-left".to_string(),
                x_mm: 0.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "waist-right".to_string(),
                x_mm: 260.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "hem-right".to_string(),
                x_mm: 315.0,
                y_mm: 620.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "hem-left".to_string(),
                x_mm: -20.0,
                y_mm: 620.0,
                handle_in: None,
                handle_out: None,
            },
        ],
    }
}

fn validate_piece(piece: &PatternPiece) -> Result<(), JsValue> {
    if piece.points.len() < 3 {
        return Err(JsValue::from_str(
            "O contorno precisa de pelo menos três pontos.",
        ));
    }

    if !piece.seam_allowance_mm.is_finite() || piece.seam_allowance_mm < 0.0 {
        return Err(JsValue::from_str(
            "A margem de costura precisa ser um número finito e não negativo.",
        ));
    }

    if piece.id.is_empty() || piece.name.is_empty() {
        return Err(JsValue::from_str(
            "O identificador e o nome do molde não podem ficar vazios.",
        ));
    }

    if piece
        .points
        .iter()
        .any(|point| {
            !point.x_mm.is_finite()
                || !point.y_mm.is_finite()
                || point
                    .handle_in
                    .as_ref()
                    .is_some_and(|handle| !handle.x_mm.is_finite() || !handle.y_mm.is_finite())
                || point
                    .handle_out
                    .as_ref()
                    .is_some_and(|handle| !handle.x_mm.is_finite() || !handle.y_mm.is_finite())
        })
    {
        return Err(JsValue::from_str(
            "Existe um ponto com coordenada inválida.",
        ));
    }

    if piece.points.iter().any(|point| point.id.is_empty()) {
        return Err(JsValue::from_str(
            "O identificador dos pontos não pode ficar vazio.",
        ));
    }

    Ok(())
}

fn sample_pattern_contour(points: &[Point2]) -> Vec<Point2> {
    if points.len() < 2 {
        return points.to_vec();
    }

    let mut sampled = Vec::new();
    for index in 0..points.len() {
        let current = &points[index];
        let next = &points[(index + 1) % points.len()];
        let segment = sample_pattern_segment(current, next);
        let points_to_take = segment.len().saturating_sub(1);
        sampled.extend(segment.into_iter().take(points_to_take));
    }
    sampled
}

fn sample_pattern_segment(start: &Point2, end: &Point2) -> Vec<Point2> {
    if start.handle_out.is_none() && end.handle_in.is_none() {
        return vec![start.clone(), end.clone()];
    }

    let control1 = absolute_handle(start, start.handle_out.as_ref());
    let control2 = absolute_handle(end, end.handle_in.as_ref());
    if is_straight_cubic(start, &control1, &control2, end) {
        return vec![start.clone(), end.clone()];
    }

    let control_length = point_distance(start, &control1)
        + point_distance(&control1, &control2)
        + point_distance(&control2, end);
    let steps = (control_length / CUBIC_SAMPLE_SPACING_MM)
        .ceil()
        .clamp(4.0, MAX_CUBIC_STEPS as f64) as usize;
    let mut sampled = Vec::with_capacity(steps + 1);
    sampled.push(start.clone());

    for step in 1..steps {
        let t = step as f64 / steps as f64;
        let inverse = 1.0 - t;
        sampled.push(Point2 {
            id: format!("{}::{}::{step}", start.id, end.id),
            x_mm: inverse.powi(3) * start.x_mm
                + 3.0 * inverse.powi(2) * t * control1.x_mm
                + 3.0 * inverse * t.powi(2) * control2.x_mm
                + t.powi(3) * end.x_mm,
            y_mm: inverse.powi(3) * start.y_mm
                + 3.0 * inverse.powi(2) * t * control1.y_mm
                + 3.0 * inverse * t.powi(2) * control2.y_mm
                + t.powi(3) * end.y_mm,
            handle_in: None,
            handle_out: None,
        });
    }

    sampled.push(end.clone());
    sampled
}

fn absolute_handle(point: &Point2, handle: Option<&Vector2>) -> Point2 {
    Point2 {
        id: format!("{}-handle", point.id),
        x_mm: point.x_mm + handle.map_or(0.0, |value| value.x_mm),
        y_mm: point.y_mm + handle.map_or(0.0, |value| value.y_mm),
        handle_in: None,
        handle_out: None,
    }
}

fn point_distance(left: &Point2, right: &Point2) -> f64 {
    (right.x_mm - left.x_mm).hypot(right.y_mm - left.y_mm)
}

fn is_straight_cubic(
    start: &Point2,
    control1: &Point2,
    control2: &Point2,
    end: &Point2,
) -> bool {
    let chord_x = end.x_mm - start.x_mm;
    let chord_y = end.y_mm - start.y_mm;
    let chord_squared = chord_x * chord_x + chord_y * chord_y;
    if chord_squared <= GEOMETRY_EPSILON {
        return false;
    }

    [control1, control2].iter().all(|control| {
        let relative_x = control.x_mm - start.x_mm;
        let relative_y = control.y_mm - start.y_mm;
        let distance_numerator = (chord_x * relative_y - chord_y * relative_x).abs();
        let projection = relative_x * chord_x + relative_y * chord_y;
        distance_numerator / chord_squared.sqrt() <= 0.01
            && projection >= 0.0
            && projection <= chord_squared
    })
}

fn polygon_area(points: &[Point2]) -> f64 {
    polygon_signed_area(points).abs()
}

fn polygon_perimeter(points: &[Point2]) -> f64 {
    if points.len() < 2 {
        return 0.0;
    }

    points
        .iter()
        .enumerate()
        .map(|(index, current)| {
            let next = &points[(index + 1) % points.len()];
            (next.x_mm - current.x_mm).hypot(next.y_mm - current.y_mm)
        })
        .sum()
}

fn polygon_signed_area(points: &[Point2]) -> f64 {
    if points.len() < 3 {
        return 0.0;
    }

    let mut twice_area = 0.0;
    for index in 0..points.len() {
        let current = &points[index];
        let next = &points[(index + 1) % points.len()];
        twice_area += current.x_mm * next.y_mm - next.x_mm * current.y_mm;
    }

    twice_area / 2.0
}

fn validate_pattern_contour(points: &[Point2]) -> Vec<String> {
    if points.len() < 3 {
        return vec!["O contorno precisa ter pelo menos três pontos.".to_string()];
    }

    if points
        .iter()
        .any(|point| !point.x_mm.is_finite() || !point.y_mm.is_finite())
    {
        return vec!["Existe um ponto com coordenada inválida.".to_string()];
    }

    let mut issues = Vec::new();
    let mut ids = HashSet::with_capacity(points.len());
    if points.iter().any(|point| !ids.insert(point.id.as_str())) {
        issues.push("Existem pontos com identificadores duplicados.".to_string());
    }

    if has_duplicate_coordinates(points) {
        issues.push("Existem pontos sobrepostos no contorno.".to_string());
    }

    if polygon_signed_area(points).abs() <= GEOMETRY_EPSILON {
        issues.push("O contorno não possui área suficiente.".to_string());
    }

    if has_self_intersection(points) {
        issues.push("O contorno possui uma autointerseção.".to_string());
    }

    issues
}

fn has_duplicate_coordinates(points: &[Point2]) -> bool {
    for left in 0..points.len() {
        for right in (left + 1)..points.len() {
            if (points[left].x_mm - points[right].x_mm).abs() <= GEOMETRY_EPSILON
                && (points[left].y_mm - points[right].y_mm).abs() <= GEOMETRY_EPSILON
            {
                return true;
            }
        }
    }

    false
}

fn has_self_intersection(points: &[Point2]) -> bool {
    for first in 0..points.len() {
        let first_next = (first + 1) % points.len();

        for second in (first + 1)..points.len() {
            let second_next = (second + 1) % points.len();
            let adjacent = first == second || first_next == second || second_next == first;

            if adjacent {
                continue;
            }

            if segments_intersect(
                &points[first],
                &points[first_next],
                &points[second],
                &points[second_next],
            ) {
                return true;
            }
        }
    }

    false
}

fn segments_intersect(a: &Point2, b: &Point2, c: &Point2, d: &Point2) -> bool {
    let ab_c = cross(a, b, c);
    let ab_d = cross(a, b, d);
    let cd_a = cross(c, d, a);
    let cd_b = cross(c, d, b);

    if ((ab_c > GEOMETRY_EPSILON && ab_d < -GEOMETRY_EPSILON)
        || (ab_c < -GEOMETRY_EPSILON && ab_d > GEOMETRY_EPSILON))
        && ((cd_a > GEOMETRY_EPSILON && cd_b < -GEOMETRY_EPSILON)
            || (cd_a < -GEOMETRY_EPSILON && cd_b > GEOMETRY_EPSILON))
    {
        return true;
    }

    (ab_c.abs() <= GEOMETRY_EPSILON && point_on_segment(c, a, b))
        || (ab_d.abs() <= GEOMETRY_EPSILON && point_on_segment(d, a, b))
        || (cd_a.abs() <= GEOMETRY_EPSILON && point_on_segment(a, c, d))
        || (cd_b.abs() <= GEOMETRY_EPSILON && point_on_segment(b, c, d))
}

fn point_on_segment(point: &Point2, start: &Point2, end: &Point2) -> bool {
    point.x_mm >= start.x_mm.min(end.x_mm) - GEOMETRY_EPSILON
        && point.x_mm <= start.x_mm.max(end.x_mm) + GEOMETRY_EPSILON
        && point.y_mm >= start.y_mm.min(end.y_mm) - GEOMETRY_EPSILON
        && point.y_mm <= start.y_mm.max(end.y_mm) + GEOMETRY_EPSILON
}

fn cross(a: &Point2, b: &Point2, c: &Point2) -> f64 {
    (b.x_mm - a.x_mm) * (c.y_mm - a.y_mm)
        - (b.y_mm - a.y_mm) * (c.x_mm - a.x_mm)
}

fn to_js_value<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_square_area() {
        let points = vec![
            Point2 {
                id: "a".into(),
                x_mm: 0.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "b".into(),
                x_mm: 100.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "c".into(),
                x_mm: 100.0,
                y_mm: 100.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "d".into(),
                x_mm: 0.0,
                y_mm: 100.0,
                handle_in: None,
                handle_out: None,
            },
        ];

        assert_eq!(polygon_area(&points), 10_000.0);
        assert_eq!(polygon_perimeter(&points), 400.0);
    }

    #[test]
    fn validates_self_intersections_and_duplicates() {
        let crossed = vec![
            Point2 {
                id: "a".into(),
                x_mm: 0.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "b".into(),
                x_mm: 100.0,
                y_mm: 100.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "c".into(),
                x_mm: 0.0,
                y_mm: 100.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "d".into(),
                x_mm: 100.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
        ];
        assert!(validate_pattern_contour(&crossed)
            .iter()
            .any(|issue| issue == "O contorno possui uma autointerseção."));

        let duplicated = vec![
            Point2 {
                id: "same".into(),
                x_mm: 0.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "b".into(),
                x_mm: 100.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
            Point2 {
                id: "same".into(),
                x_mm: 0.0,
                y_mm: 0.0,
                handle_in: None,
                handle_out: None,
            },
        ];
        let issues = validate_pattern_contour(&duplicated);
        assert!(issues
            .iter()
            .any(|issue| issue == "Existem pontos com identificadores duplicados."));
        assert!(issues
            .iter()
            .any(|issue| issue == "Existem pontos sobrepostos no contorno."));
    }

    #[test]
    fn samples_cubic_segments_with_a_bounded_point_count() {
        let start = Point2 {
            id: "start".into(),
            x_mm: 0.0,
            y_mm: 0.0,
            handle_in: None,
            handle_out: Some(Vector2 {
                x_mm: 60.0,
                y_mm: -80.0,
            }),
        };
        let end = Point2 {
            id: "end".into(),
            x_mm: 180.0,
            y_mm: 0.0,
            handle_in: Some(Vector2 {
                x_mm: -60.0,
                y_mm: -80.0,
            }),
            handle_out: None,
        };

        let sampled = sample_pattern_segment(&start, &end);
        assert!(sampled.len() > 2);
        assert!(sampled.len() <= MAX_CUBIC_STEPS + 1);
        assert!(sampled.iter().any(|point| point.y_mm < -50.0));
    }
}
