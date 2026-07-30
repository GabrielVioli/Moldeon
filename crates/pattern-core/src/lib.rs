use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

const GEOMETRY_EPSILON: f64 = 1e-8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point2 {
    pub id: String,
    pub x_mm: f64,
    pub y_mm: f64,
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
        let area_mm2 = polygon_area(&self.piece.points);
        let perimeter_mm = polygon_perimeter(&self.piece.points);
        let issues = validate_pattern_contour(&self.piece.points);

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
            },
            Point2 {
                id: "waist-right".to_string(),
                x_mm: 260.0,
                y_mm: 0.0,
            },
            Point2 {
                id: "hem-right".to_string(),
                x_mm: 315.0,
                y_mm: 620.0,
            },
            Point2 {
                id: "hem-left".to_string(),
                x_mm: -20.0,
                y_mm: 620.0,
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
        .any(|point| !point.x_mm.is_finite() || !point.y_mm.is_finite())
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
            },
            Point2 {
                id: "b".into(),
                x_mm: 100.0,
                y_mm: 0.0,
            },
            Point2 {
                id: "c".into(),
                x_mm: 100.0,
                y_mm: 100.0,
            },
            Point2 {
                id: "d".into(),
                x_mm: 0.0,
                y_mm: 100.0,
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
            },
            Point2 {
                id: "b".into(),
                x_mm: 100.0,
                y_mm: 100.0,
            },
            Point2 {
                id: "c".into(),
                x_mm: 0.0,
                y_mm: 100.0,
            },
            Point2 {
                id: "d".into(),
                x_mm: 100.0,
                y_mm: 0.0,
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
            },
            Point2 {
                id: "b".into(),
                x_mm: 100.0,
                y_mm: 0.0,
            },
            Point2 {
                id: "same".into(),
                x_mm: 0.0,
                y_mm: 0.0,
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
}
